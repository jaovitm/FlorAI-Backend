import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types/env";
import {
  affiliateBalances,
  affiliateLink,
  affiliateMonthly,
  affiliateStats,
  affiliateStoreLink,
  createAffiliate,
  parsePeriod,
  partnerUrl,
  updateAffiliate,
  type AffiliateRow,
  type AffiliateStats,
} from "../lib/affiliates";
import { newId, sha256Hex } from "../lib/crypto";
import { ApiError, notFound, validationError } from "../lib/errors";
import { nowIso, publicOrigin, readJson } from "../lib/http";
import { adminPage } from "../pages/admin";

/** Painel do programa de afiliados. A API exige `Authorization: Bearer <ADMIN_TOKEN>`. */
const admin = new Hono<AppEnv>();

admin.get("/", (c) => c.html(adminPage()));

admin.use("/api/*", async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  const given = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
  // Compara os hashes para não vazar o tamanho/prefixo da senha pelo tempo de resposta.
  if (!expected || !given || (await sha256Hex(given)) !== (await sha256Hex(expected))) {
    throw new ApiError(401, "unauthorized", "Senha do painel incorreta.");
  }
  await next();
});

const affiliateJson = (
  c: Context<AppEnv>,
  a: AffiliateRow,
  stats?: AffiliateStats,
  balance?: { commissionCents: number; paidCents: number; dueCents: number },
) => ({
  id: a.id,
  code: a.code,
  name: a.name,
  contact: a.contact,
  bonusDays: a.bonus_days,
  firstRate: a.first_rate,
  firstMonths: a.first_months,
  rate: a.rate,
  active: a.active === 1,
  createdAt: a.created_at,
  link: affiliateLink(publicOrigin(c), a.code),
  storeLink: affiliateStoreLink(c.env.PLAY_PACKAGE_NAME, a.code),
  partnerUrl: partnerUrl(publicOrigin(c), a.stats_token),
  stats,
  balance,
});

admin.get("/api/affiliates", async (c) => {
  const range = parsePeriod(c.req.query("period"));
  const [{ results }, stats, balances] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM affiliates ORDER BY active DESC, created_at DESC").all<AffiliateRow>(),
    affiliateStats(c.env.DB, range),
    affiliateBalances(c.env.DB),
  ]);
  return c.json({
    period: range.period,
    items: results.map((a) => affiliateJson(c, a, stats.get(a.id), balances.get(a.id))),
  });
});

admin.post("/api/affiliates", async (c) => {
  const row = await createAffiliate(c.env.DB, await readJson(c));
  return c.json(affiliateJson(c, row), 201);
});

const findAffiliate = async (c: Context<AppEnv>) => {
  const row = await c.env.DB.prepare("SELECT * FROM affiliates WHERE id = ?").bind(c.req.param("id")).first<AffiliateRow>();
  if (!row) throw notFound("Parceiro não encontrado.");
  return row;
};

admin.get("/api/affiliates/:id", async (c) => {
  const row = await findAffiliate(c);
  const [monthly, payouts] = await Promise.all([
    affiliateMonthly(c.env.DB, row.id),
    c.env.DB.prepare("SELECT id, amount_cents, note, paid_at FROM affiliate_payouts WHERE affiliate_id = ? ORDER BY paid_at DESC")
      .bind(row.id)
      .all<{ id: string; amount_cents: number; note: string | null; paid_at: string }>(),
  ]);
  return c.json({
    affiliate: affiliateJson(c, row),
    monthly,
    payouts: payouts.results.map((p) => ({ id: p.id, amountCents: p.amount_cents, note: p.note, paidAt: p.paid_at })),
  });
});

admin.patch("/api/affiliates/:id", async (c) => {
  await findAffiliate(c);
  const row = await updateAffiliate(c.env.DB, c.req.param("id"), await readJson(c));
  return c.json(affiliateJson(c, row!));
});

// Comissão paga ao parceiro (PIX etc.): abate do saldo a pagar.
admin.post("/api/affiliates/:id/payouts", async (c) => {
  const row = await findAffiliate(c);
  const body = await readJson(c);
  const amount = Number(body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0) throw validationError("Informe o valor pago.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;
  const payout = { id: newId("pay"), amountCents: amount, note, paidAt: nowIso() };
  await c.env.DB.prepare("INSERT INTO affiliate_payouts (id, affiliate_id, amount_cents, note, paid_at) VALUES (?, ?, ?, ?, ?)")
    .bind(payout.id, row.id, amount, note, payout.paidAt)
    .run();
  return c.json(payout, 201);
});

export default admin;
