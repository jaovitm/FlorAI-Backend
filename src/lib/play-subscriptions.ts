import type { Bindings } from "../types/env";
import { recordPayment } from "./affiliates";
import { sha256Hex } from "./crypto";
import { acknowledgePlaySubscription, getPlaySubscription, PLAY_PRODUCTS, type PlaySubscription } from "./google-play";
import { normalizeIso, nowIso } from "./http";
import { PLANS, type Plan } from "./plans";

type PurchaseRow = { plan: Plan; state: string; started_at: string; expires_at: string };

/** A compra dá direito ao plano agora? (tabela da seção 6) */
export function grantsAccess(state: string, expiresAt: string, now = nowIso()) {
  if (state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") return true;
  return state === "SUBSCRIPTION_STATE_CANCELED" && expiresAt > now;
}

export const expiryOf = (purchase: PlaySubscription) => normalizeIso(purchase.lineItems[0]?.expiryTime) ?? nowIso();

/** SHA-256 do id: o `obfuscatedAccountId` que o app grava em cada compra. */
export async function ensurePlayAccountId(db: D1Database, user: { id: string; play_account_id: string | null }) {
  if (user.play_account_id) return user.play_account_id;
  const accountId = await sha256Hex(user.id);
  await db.prepare("UPDATE users SET play_account_id = ? WHERE id = ?").bind(accountId, user.id).run();
  user.play_account_id = accountId;
  return accountId;
}

/** Grava (ou atualiza) a compra com o estado vindo do Google. Nunca troca o dono de um token. */
export async function savePlayPurchase(db: D1Database, userId: string, token: string, purchase: PlaySubscription) {
  const item = purchase.lineItems[0];
  const plan = PLAY_PRODUCTS[item?.productId ?? ""];
  if (!plan) throw new Error(`Produto do Google Play desconhecido: ${item?.productId}`);
  const now = nowIso();

  const statements = [
    db
      .prepare(
        `INSERT INTO play_purchases (purchase_token, user_id, product_id, plan, state, started_at, expires_at,
           auto_renewing, acknowledged, linked_purchase_token, latest_order_id, test_purchase, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (purchase_token) DO UPDATE SET
           product_id = excluded.product_id, plan = excluded.plan, state = excluded.state,
           expires_at = excluded.expires_at, auto_renewing = excluded.auto_renewing,
           acknowledged = MAX(play_purchases.acknowledged, excluded.acknowledged),
           latest_order_id = excluded.latest_order_id, updated_at = excluded.updated_at
         WHERE play_purchases.user_id = excluded.user_id`,
      )
      .bind(
        token,
        userId,
        item.productId,
        plan,
        purchase.subscriptionState,
        normalizeIso(purchase.startTime) ?? now,
        expiryOf(purchase),
        item.autoRenewingPlan?.autoRenewEnabled ? 1 : 0,
        purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" ? 1 : 0,
        purchase.linkedPurchaseToken ?? null,
        purchase.latestOrderId ?? null,
        purchase.testPurchase ? 1 : 0,
        now,
      ),
  ];
  // Troca de plano: a assinatura antiga foi substituída por esta.
  if (purchase.linkedPurchaseToken) {
    statements.push(
      db
        .prepare("UPDATE play_purchases SET superseded = 1, updated_at = ? WHERE purchase_token = ? AND user_id = ?")
        .bind(now, purchase.linkedPurchaseToken, userId),
    );
  }
  await db.batch(statements);

  // Cobrança nova (compra ou renovação): receita e comissão de afiliado.
  try {
    await recordPayment(db, userId, token, purchase);
  } catch (err) {
    // Não atrapalha a liberação do plano; o próximo webhook ou GET /subscription tenta de novo.
    console.error("Falha ao registrar pagamento", err);
  }
}

/** Confirma no Google se ainda está pendente e a compra dá acesso. */
export async function acknowledgeIfNeeded(env: Bindings, token: string, purchase: PlaySubscription) {
  if (purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING") return;
  if (!grantsAccess(purchase.subscriptionState, expiryOf(purchase))) return;
  if (await acknowledgePlaySubscription(env, purchase.lineItems[0].productId, token)) {
    await env.DB.prepare("UPDATE play_purchases SET acknowledged = 1 WHERE purchase_token = ?").bind(token).run();
  }
}

/**
 * Recalcula `subscriptions` (o plano vigente, usado por `getPlan`) a partir das compras.
 * Quem nunca comprou pela loja fica como está (free ou modo de teste).
 */
export async function syncSubscription(db: D1Database, userId: string) {
  const { results } = await db
    .prepare("SELECT plan, state, started_at, expires_at FROM play_purchases WHERE user_id = ? AND superseded = 0")
    .bind(userId)
    .all<PurchaseRow>();
  if (results.length === 0) return;

  const now = nowIso();
  const best = results
    .filter((r) => grantsAccess(r.state, r.expires_at, now))
    .sort((a, b) => PLANS.indexOf(b.plan) - PLANS.indexOf(a.plan))[0];

  await db
    .prepare(
      `INSERT INTO subscriptions (user_id, plan, started_at, renews_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         started_at = CASE WHEN subscriptions.plan = excluded.plan THEN subscriptions.started_at ELSE excluded.started_at END,
         plan = excluded.plan, renews_at = excluded.renews_at`,
    )
    .bind(userId, best?.plan ?? "free", best?.started_at ?? now, best?.expires_at ?? null)
    .run();
}

/**
 * Garantia caso um webhook se perca: compras "ativas" com validade vencida são
 * reconsultadas no Google (no máximo a cada 10 min por compra).
 */
export async function refreshStalePurchases(env: Bindings, userId: string) {
  const now = nowIso();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT purchase_token FROM play_purchases
     WHERE user_id = ? AND superseded = 0 AND expires_at < ? AND updated_at < ?
       AND state IN ('SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD')`,
  )
    .bind(userId, now, tenMinutesAgo)
    .all<{ purchase_token: string }>();

  for (const { purchase_token: token } of results) {
    try {
      const purchase = await getPlaySubscription(env, token);
      if (purchase) {
        await savePlayPurchase(env.DB, userId, token, purchase);
      } else {
        await env.DB.prepare("UPDATE play_purchases SET state = 'SUBSCRIPTION_STATE_EXPIRED', updated_at = ? WHERE purchase_token = ?")
          .bind(now, token)
          .run();
      }
    } catch (err) {
      console.error("Falha ao atualizar compra do Google Play", err); // tenta de novo depois
    }
  }
}
