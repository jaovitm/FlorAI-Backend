import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import {
  affiliateBalances,
  affiliateLink,
  affiliateMonthly,
  affiliateStats,
  affiliateStoreLink,
  findActiveAffiliate,
  parsePeriod,
  recordClick,
  recordInstall,
  type AffiliateRow,
} from "../lib/affiliates";
import { notFound } from "../lib/errors";
import { publicOrigin } from "../lib/http";
import { partnerPage } from "../pages/partner";

/** Rotas públicas do programa de afiliados (sem `Bearer`). */
const affiliates = new Hono<AppEnv>();

// Prévias de link (WhatsApp, Instagram…) e robôs não contam como clique.
const BOT_RE = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|skype|headless/i;

// Link do influenciador: conta o clique e manda para a Play Store com o cupom no referrer.
affiliates.get("/a/:code", async (c) => {
  const pkg = c.env.PLAY_PACKAGE_NAME;
  const affiliate = await findActiveAffiliate(c.env.DB, c.req.param("code"));
  c.header("Cache-Control", "no-store");
  // Cupom inexistente ou desativado: o link continua levando ao app, sem atribuição.
  if (!affiliate) return c.redirect(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`, 302);

  if (!BOT_RE.test(c.req.header("User-Agent") ?? "")) {
    const click = recordClick(c.env.DB, affiliate.id).catch((err) => console.error("Falha ao contar clique", err));
    try {
      c.executionCtx.waitUntil(click);
    } catch {
      await click; // fora do Workers (testes)
    }
  }
  return c.redirect(affiliateStoreLink(pkg, affiliate.code), 302);
});

// Primeira abertura do app instalado por um link com cupom (Install Referrer).
affiliates.post("/installs", async (c) => {
  const body = await c.req.json<{ installId?: unknown; code?: unknown }>().catch(() => null);
  const installId = typeof body?.installId === "string" ? body.installId : "";
  const code = typeof body?.code === "string" ? body.code : "";
  if (/^[A-Za-z0-9_-]{16,64}$/.test(installId) && code) {
    const affiliate = await findActiveAffiliate(c.env.DB, code);
    if (affiliate) await recordInstall(c.env.DB, installId, affiliate.id);
  }
  // Sempre 204: o app não precisa saber se o código era de influenciador.
  return c.body(null, 204);
});

// Painel do parceiro: só os números dele, sem dados dos usuários.
affiliates.get("/p/:token", (c) => c.html(partnerPage()));

affiliates.get("/p/:token/stats", async (c) => {
  const affiliate = await c.env.DB.prepare("SELECT * FROM affiliates WHERE stats_token = ?")
    .bind(c.req.param("token"))
    .first<AffiliateRow>();
  if (!affiliate) throw notFound("Painel não encontrado.");

  const range = parsePeriod(c.req.query("period"));
  const [stats, balances, monthly] = await Promise.all([
    affiliateStats(c.env.DB, range, affiliate.id),
    affiliateBalances(c.env.DB, affiliate.id),
    affiliateMonthly(c.env.DB, affiliate.id),
  ]);
  const s = stats.get(affiliate.id);
  return c.json({
    name: affiliate.name,
    code: affiliate.code,
    active: affiliate.active === 1,
    link: affiliateLink(publicOrigin(c), affiliate.code),
    bonusDays: affiliate.bonus_days,
    firstRate: affiliate.first_rate,
    firstMonths: affiliate.first_months,
    rate: affiliate.rate,
    period: range.period,
    stats: {
      clicks: s.clicks,
      installs: s.installs,
      signups: s.signups,
      activated: s.activated,
      payments: s.payments,
      payingUsers: s.payingUsers,
      activeSubscribers: s.activeSubscribers,
      netCents: s.netCents,
      commissionCents: s.commissionCents,
    },
    balance: balances.get(affiliate.id),
    monthly,
  });
});

export default affiliates;
