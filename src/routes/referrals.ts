import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { validationError } from "../lib/errors";
import { readJson } from "../lib/http";
import { redeemReferralCode, referralSummary } from "../lib/referrals";

const referrals = new Hono<AppEnv>();

referrals.get("/", async (c) => c.json(await referralSummary(c.env.DB, c.get("user"), c.env.PLAY_PACKAGE_NAME)));

// Código informado depois do cadastro (até REDEEM_WINDOW_DAYS dias de conta).
referrals.post("/redeem", async (c) => {
  const body = await readJson(c);
  if (typeof body.code !== "string" || !body.code.trim()) throw validationError("Informe o código de indicação.");
  const user = c.get("user");
  await redeemReferralCode(c.env.DB, user, body.code);
  // Relê o usuário: a recompensa pode ter saído na hora (quem já identificou uma planta).
  const fresh = await c.env.DB.prepare("SELECT bonus_pro_until FROM users WHERE id = ?")
    .bind(user.id)
    .first<string | null>("bonus_pro_until");
  return c.json(await referralSummary(c.env.DB, { ...user, bonus_pro_until: fresh ?? null }, c.env.PLAY_PACKAGE_NAME));
});

export default referrals;
