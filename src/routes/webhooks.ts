import { Hono } from "hono";
import type { AppEnv, Bindings } from "../types/env";
import { getPlaySubscription } from "../lib/google-play";
import { nowIso } from "../lib/http";
import { markRefunded } from "../lib/affiliates";
import { acknowledgeIfNeeded, savePlayPurchase, syncSubscription } from "../lib/play-subscriptions";

type DeveloperNotification = {
  packageName?: string;
  subscriptionNotification?: { notificationType: number; purchaseToken: string };
  voidedPurchaseNotification?: { purchaseToken: string; orderId: string };
  testNotification?: { version: string };
};

const webhooks = new Hono<AppEnv>();

webhooks.post("/google-play", async (c) => {
  if (!c.env.PLAY_WEBHOOK_SECRET || c.req.query("secret") !== c.env.PLAY_WEBHOOK_SECRET) {
    return c.body(null, 401);
  }
  const envelope = await c.req.json<{ message?: { data?: string } }>().catch(() => null);
  const data = envelope?.message?.data;
  // Respostas 2xx para o que não nos interessa; senão o Pub/Sub reenvia para sempre.
  if (!data) return c.body(null, 204);

  let notification: DeveloperNotification;
  try {
    notification = JSON.parse(atob(data));
  } catch {
    return c.body(null, 204);
  }
  if (notification.packageName !== c.env.PLAY_PACKAGE_NAME) return c.body(null, 204);
  if (notification.testNotification) {
    console.log("RTDN de teste recebida");
    return c.body(null, 204);
  }

  const voided = notification.voidedPurchaseNotification;
  // O pedido reembolsado sai da receita e da comissão do afiliado.
  if (voided?.orderId) await markRefunded(c.env.DB, voided.orderId);
  const token = notification.subscriptionNotification?.purchaseToken ?? voided?.purchaseToken;
  if (token) await handlePlayNotification(c.env, token, Boolean(voided));
  // Erros sobem para o onError (500) e o Pub/Sub tenta de novo.
  return c.body(null, 204);
});

async function handlePlayNotification(env: Bindings, token: string, voided: boolean) {
  const db = env.DB;
  let userId = await db
    .prepare("SELECT user_id FROM play_purchases WHERE purchase_token = ?")
    .bind(token)
    .first<string>("user_id");

  // Reembolso ou estorno: tira o acesso na hora.
  if (voided) {
    if (!userId) return;
    const now = nowIso();
    await db
      .prepare("UPDATE play_purchases SET state = 'SUBSCRIPTION_STATE_EXPIRED', expires_at = ?, updated_at = ? WHERE purchase_token = ?")
      .bind(now, now, token)
      .run();
    await syncSubscription(db, userId);
    return;
  }

  const purchase = await getPlaySubscription(env, token);
  if (!purchase) return;

  // O app ainda não enviou esta compra (fechou antes de validar, pagamento pendente aprovado
  // com o app fechado…). O obfuscatedAccountId diz de quem ela é.
  if (!userId) {
    const accountId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (!accountId) return; // compra feita fora do app: o app envia quando o usuário abrir
    userId = await db.prepare("SELECT id FROM users WHERE play_account_id = ?").bind(accountId).first<string>("id");
    if (!userId) return;
  }

  await savePlayPurchase(db, userId, token, purchase);
  await syncSubscription(db, userId);
  await acknowledgeIfNeeded(env, token, purchase);
}

export default webhooks;
