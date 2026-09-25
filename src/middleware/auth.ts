import { createMiddleware } from "hono/factory";
import type { AppEnv, UserRow } from "../types/env";
import { sha256Hex } from "../lib/crypto";
import { unauthorized } from "../lib/errors";
import { nowIso, parseTzOffset } from "../lib/http";

/** Exige `Authorization: Bearer <token>` válido e carrega o usuário no contexto. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw unauthorized();

  const tokenHash = await sha256Hex(match[1]);
  const user = await c.env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, nowIso())
    .first<UserRow>();
  if (!user) throw unauthorized();

  // Guarda o último fuso recebido (só escreve quando muda).
  const tz = parseTzOffset(c.req.header("X-Timezone-Offset"));
  if (tz !== undefined && tz !== user.tz_offset) {
    await c.env.DB.prepare("UPDATE users SET tz_offset = ? WHERE id = ?").bind(tz, user.id).run();
    user.tz_offset = tz;
  }

  c.set("user", user);
  c.set("tokenHash", tokenHash);
  c.set("tzOffset", user.tz_offset);
  await next();
});
