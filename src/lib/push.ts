import { ApiError } from "./errors";
import { parseServiceAccount, sendPush, type PushMessage, type PushResult } from "./fcm";
import type { Bindings } from "../types/env";

/**
 * Envia push para o aparelho do usuário. Sem token salvo, não faz nada.
 * Token recusado pelo FCM (logout, app desinstalado) é apagado.
 */
export async function notifyUser(
  env: Bindings,
  user: { id: string; push_token: string | null },
  message: PushMessage,
): Promise<PushResult | null> {
  if (!user.push_token) return null;
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw new ApiError(500, "internal_error", "Push não configurado no servidor.");
  }
  const result = await sendPush(parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT), user.push_token, message);
  if (!result.ok && result.invalidToken) await forgetPushToken(env.DB, user.id, user.push_token);
  return result;
}

/** Apaga o token que o FCM recusou (só se ainda for o token atual do usuário). */
export const forgetPushToken = (db: D1Database, userId: string, token: string) =>
  db
    .prepare("UPDATE users SET push_token = NULL, push_platform = NULL WHERE id = ? AND push_token = ?")
    .bind(userId, token)
    .run();
