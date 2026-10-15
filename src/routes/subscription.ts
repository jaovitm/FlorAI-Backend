import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { ApiError, invalidPurchase, purchaseInUse, validationError } from "../lib/errors";
import { getPlaySubscription, PLAY_PRODUCTS } from "../lib/google-play";
import { addDays, localDay, readJson } from "../lib/http";
import { isPlan } from "../lib/plans";
import {
  acknowledgeIfNeeded,
  ensurePlayAccountId,
  expiryOf,
  grantsAccess,
  refreshStalePurchases,
  savePlayPurchase,
  syncSubscription,
} from "../lib/play-subscriptions";
import { subscriptionJson, type SubscriptionRow } from "../lib/serialize";

export const subscription = new Hono<AppEnv>();

subscription.get("/", async (c) => {
  const user = c.get("user");
  // Preenche o play_account_id de contas antigas e corrige compras cujo webhook se perdeu.
  await ensurePlayAccountId(c.env.DB, user);
  await refreshStalePurchases(c.env, user.id);
  await syncSubscription(c.env.DB, user.id);

  const row = await c.env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .bind(user.id)
    .first<SubscriptionRow>();
  // Usuários sem linha (não deveria acontecer) são tratados como free desde o cadastro.
  return c.json(
    subscriptionJson(
      row ?? { user_id: user.id, plan: "free", started_at: user.created_at, renews_at: null },
      user.bonus_pro_until,
    ),
  );
});

// Modo de teste: troca o plano na hora, sem cobrança.
subscription.post("/", async (c) => {
  if (c.env.ALLOW_TEST_SUBSCRIPTIONS !== "true") {
    throw new ApiError(403, "forbidden", "Assine pelo app do FlorAI no Google Play.");
  }
  const body = await readJson(c);
  if (!isPlan(body.plan)) throw validationError("Plano inválido.");

  const now = new Date();
  const renewsAt = body.plan === "free" ? null : addDays(now, 30).toISOString();
  const row = await c.env.DB.prepare(
    `INSERT INTO subscriptions (user_id, plan, started_at, renews_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, started_at = excluded.started_at,
       renews_at = excluded.renews_at
     RETURNING *`,
  )
    .bind(c.get("user").id, body.plan, now.toISOString(), renewsAt)
    .first<SubscriptionRow>();
  return c.json(subscriptionJson(row!, c.get("user").bonus_pro_until));
});

// Compra do Google Play enviada pelo app. Idempotente: reenviar só devolve a assinatura atual.
subscription.post("/purchases", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const body = await readJson(c);
  const { store, productId, purchaseToken } = body;
  if (store !== "google_play" || typeof productId !== "string" || typeof purchaseToken !== "string" || !purchaseToken) {
    throw validationError("Compra inválida.");
  }
  if (!PLAY_PRODUCTS[productId]) throw invalidPurchase("Este plano não existe.");

  const accountId = await ensurePlayAccountId(db, user);
  const known = await db
    .prepare("SELECT user_id, superseded FROM play_purchases WHERE purchase_token = ?")
    .bind(purchaseToken)
    .first<{ user_id: string; superseded: number }>();
  if (known && known.user_id !== user.id) throw purchaseInUse();

  // Token de um plano já trocado por outro: nada a fazer, só devolve o plano atual.
  if (!known?.superseded) {
    const purchase = await getPlaySubscription(c.env, purchaseToken);
    if (!purchase) throw invalidPurchase("Não encontramos esta compra no Google Play.");
    if (purchase.lineItems[0]?.productId !== productId) {
      throw invalidPurchase("A compra não corresponde a este plano.");
    }
    // Compras feitas fora do app (ex.: código promocional) não têm o id; ficam com quem enviou primeiro.
    const owner = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (owner && owner !== accountId) throw purchaseInUse();

    await savePlayPurchase(db, user.id, purchaseToken, purchase);
    await syncSubscription(db, user.id); // libera o plano antes de confirmar no Google
    if (!grantsAccess(purchase.subscriptionState, expiryOf(purchase))) {
      throw invalidPurchase("Esta assinatura não está ativa.");
    }
    await acknowledgeIfNeeded(c.env, purchaseToken, purchase);
  }

  const row = await db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").bind(user.id).first<SubscriptionRow>();
  return c.json(
    subscriptionJson(
      row ?? { user_id: user.id, plan: "free", started_at: user.created_at, renews_at: null },
      user.bonus_pro_until,
    ),
  );
});

export const usage = new Hono<AppEnv>();

usage.get("/today", async (c) => {
  const day = localDay(c.get("tzOffset"));
  const identifications = await c.env.DB.prepare(
    "SELECT identifications FROM daily_usage WHERE user_id = ? AND day = ?",
  )
    .bind(c.get("user").id, day)
    .first<number>("identifications");
  return c.json({ day, identifications: identifications ?? 0 });
});
