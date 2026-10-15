import { newId, newToken } from "./crypto";
import { validationError } from "./errors";
import { PLAY_PRODUCTS, type PlaySubscription } from "./google-play";
import { nowIso } from "./http";
import { GOOGLE_FEE, PLAN_PRICE_CENTS } from "./plans";
import { normalizeReferralCode, playStoreLink } from "./referrals";

/** Cupom do influenciador: 3 a 20 letras ou números (ex.: MARINA, PLANTAS10). */
export const AFFILIATE_CODE_RE = /^[A-Z0-9]{3,20}$/;

/** Relatórios por dia e mês no horário de Brasília (UTC−3, sem horário de verão). */
const REPORT_OFFSET_HOURS = -3;

export type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  bonus_days: number;
  first_rate: number;
  first_months: number;
  rate: number;
  stats_token: string;
  active: number;
  created_at: string;
};

export type AffiliateInput = {
  code?: unknown;
  name?: unknown;
  contact?: unknown;
  bonusDays?: unknown;
  firstRate?: unknown;
  firstMonths?: unknown;
  rate?: unknown;
  active?: unknown;
};

// ---------------------------------------------------------------- links

/** Link curto para a bio/stories: conta o clique e manda para a Play Store. */
export const affiliateLink = (origin: string, code: string) => `${origin}/a/${code}`;

/** Destino do link curto: Play Store com o cupom no `referrer` (o app preenche o cadastro). */
export const affiliateStoreLink = (packageName: string, code: string) =>
  playStoreLink(packageName, code, { utm_source: code.toLowerCase(), utm_medium: "influencer", utm_campaign: "afiliados" });

export const partnerUrl = (origin: string, token: string) => `${origin}/p/${token}`;

// ---------------------------------------------------------------- cadastro

/** Valida os campos enviados pelo painel. `partial` aceita só os campos presentes (edição). */
export function parseAffiliateInput(body: AffiliateInput, partial = false) {
  const out: Partial<Omit<AffiliateRow, "id" | "stats_token" | "created_at">> = {};
  const has = (key: keyof AffiliateInput) => !partial || key in body;

  if (has("name")) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) throw validationError("Informe o nome do parceiro (até 80 caracteres).");
    out.name = name;
  }
  if (has("code")) {
    const code = typeof body.code === "string" ? normalizeReferralCode(body.code) : "";
    if (!AFFILIATE_CODE_RE.test(code)) throw validationError("O cupom precisa ter de 3 a 20 letras ou números, sem espaços.");
    out.code = code;
  }
  if ("contact" in body) {
    if (body.contact !== null && typeof body.contact !== "string") throw validationError("Contato inválido.");
    out.contact = (body.contact as string | null)?.trim().slice(0, 200) || null;
  }
  const integer = (key: "bonusDays" | "firstMonths", min: number, max: number, fallback: number) => {
    if (!(key in body)) return partial ? undefined : fallback;
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw validationError(`Valor inválido em ${key} (${min} a ${max}).`);
    return n;
  };
  const percent = (key: "firstRate" | "rate", fallback: number) => {
    if (!(key in body)) return partial ? undefined : fallback;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw validationError(`Valor inválido em ${key} (0 a 1, ex.: 0.2 = 20%).`);
    return n;
  };
  const bonusDays = integer("bonusDays", 0, 90, 7);
  const firstMonths = integer("firstMonths", 0, 36, 3);
  const firstRate = percent("firstRate", 0.2);
  const rate = percent("rate", 0.1);
  if (bonusDays !== undefined) out.bonus_days = bonusDays;
  if (firstMonths !== undefined) out.first_months = firstMonths;
  if (firstRate !== undefined) out.first_rate = firstRate;
  if (rate !== undefined) out.rate = rate;
  if ("active" in body) {
    if (typeof body.active !== "boolean") throw validationError("Valor inválido em active.");
    out.active = body.active ? 1 : 0;
  }
  return out;
}

/** O cupom não pode coincidir com outro cupom nem com o código de indicação de um usuário. */
async function ensureCodeFree(db: D1Database, code: string, exceptId?: string) {
  const taken =
    (await db.prepare("SELECT 1 FROM affiliates WHERE code = ? AND id IS NOT ?").bind(code, exceptId ?? null).first()) ??
    (await db.prepare("SELECT 1 FROM users WHERE referral_code = ?").bind(code).first());
  if (taken) throw validationError("Este cupom já está em uso. Escolha outro.");
}

export async function createAffiliate(db: D1Database, body: AffiliateInput) {
  const input = parseAffiliateInput(body);
  await ensureCodeFree(db, input.code!);
  const row: AffiliateRow = {
    id: newId("aff"),
    code: input.code!,
    name: input.name!,
    contact: input.contact ?? null,
    bonus_days: input.bonus_days!,
    first_rate: input.first_rate!,
    first_months: input.first_months!,
    rate: input.rate!,
    stats_token: newToken(),
    active: 1,
    created_at: nowIso(),
  };
  await db
    .prepare(
      `INSERT INTO affiliates (id, code, name, contact, bonus_days, first_rate, first_months, rate, stats_token, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.code, row.name, row.contact, row.bonus_days, row.first_rate, row.first_months, row.rate, row.stats_token, 1, row.created_at)
    .run();
  return row;
}

/**
 * Edita o parceiro. Mudar a comissão só vale para pagamentos futuros: a comissão de cada
 * pagamento é gravada no momento em que ele acontece.
 */
export async function updateAffiliate(db: D1Database, id: string, body: AffiliateInput) {
  const input = parseAffiliateInput(body, true);
  if (input.code) await ensureCodeFree(db, input.code, id);
  const columns = Object.keys(input) as (keyof typeof input)[];
  if (columns.length > 0) {
    await db
      .prepare(`UPDATE affiliates SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...columns.map((c) => input[c] ?? null), id)
      .run();
  }
  return db.prepare("SELECT * FROM affiliates WHERE id = ?").bind(id).first<AffiliateRow>();
}

// ---------------------------------------------------------------- rastreio

export const findActiveAffiliate = (db: D1Database, rawCode: string) => {
  const code = normalizeReferralCode(rawCode);
  if (!AFFILIATE_CODE_RE.test(code)) return Promise.resolve(null);
  return db.prepare("SELECT * FROM affiliates WHERE code = ? AND active = 1").bind(code).first<AffiliateRow>();
};

/** Dia (`yyyy-MM-dd`) no horário dos relatórios. */
export const reportDay = (date = new Date()) =>
  new Date(date.getTime() + REPORT_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);

export const recordClick = (db: D1Database, affiliateId: string) =>
  db
    .prepare(
      `INSERT INTO affiliate_clicks (affiliate_id, day, clicks) VALUES (?, ?, 1)
       ON CONFLICT (affiliate_id, day) DO UPDATE SET clicks = clicks + 1`,
    )
    .bind(affiliateId, reportDay())
    .run();

export const recordInstall = (db: D1Database, installId: string, affiliateId: string) =>
  db
    .prepare("INSERT INTO app_installs (install_id, affiliate_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(installId, affiliateId, nowIso())
    .run();

/** Estados em que o pedido mais recente foi pago (no período de carência ele ainda não foi). */
const PAID_STATES = new Set(["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_CANCELED"]);

const addMonths = (iso: string, months: number) => {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
};

/**
 * Registra a cobrança mais recente da assinatura (compra ou renovação; cada uma tem um
 * `latestOrderId` novo) e a comissão do influenciador que trouxe o usuário. Idempotente.
 *
 * O valor é o preço do plano em `PLAN_PRICE_CENTS`: a API de assinaturas do Google não
 * informa quanto foi cobrado (créditos de troca de plano e promoções não aparecem aqui).
 */
export async function recordPayment(db: D1Database, userId: string, token: string, purchase: PlaySubscription) {
  const orderId = purchase.latestOrderId;
  const plan = PLAY_PRODUCTS[purchase.lineItems[0]?.productId ?? ""];
  if (!orderId || !plan || !PAID_STATES.has(purchase.subscriptionState)) return;
  if (await db.prepare("SELECT 1 FROM payments WHERE order_id = ?").bind(orderId).first()) return;

  const now = nowIso();
  const amount = PLAN_PRICE_CENTS[plan];
  const net = Math.round(amount * (1 - GOOGLE_FEE));
  const test = purchase.testPurchase ? 1 : 0;

  const affiliate = await db
    .prepare(
      `SELECT a.id, a.first_rate, a.first_months, a.rate FROM referrals r JOIN affiliates a ON a.id = r.affiliate_id
       WHERE r.referee_id = ?`,
    )
    .bind(userId)
    .first<Pick<AffiliateRow, "id" | "first_rate" | "first_months" | "rate">>();

  let rate: number | null = null;
  if (affiliate) {
    // Os primeiros meses contam a partir do 1º pagamento deste assinante.
    const firstPaidAt =
      (await db
        .prepare("SELECT MIN(paid_at) AS first FROM payments WHERE user_id = ? AND test = ?")
        .bind(userId, test)
        .first<string | null>("first")) ?? now;
    rate = now < addMonths(firstPaidAt, affiliate.first_months) ? affiliate.first_rate : affiliate.rate;
  }

  await db
    .prepare(
      `INSERT INTO payments (order_id, user_id, purchase_token, plan, amount_cents, net_cents, paid_at, test,
         affiliate_id, commission_rate, commission_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (order_id) DO NOTHING`,
    )
    .bind(orderId, userId, token, plan, amount, net, now, test, affiliate?.id ?? null, rate, rate === null ? 0 : Math.round(net * rate))
    .run();
}

/** Reembolso ou estorno: o pagamento sai dos totais e da comissão. */
export const markRefunded = (db: D1Database, orderId: string) =>
  db.prepare("UPDATE payments SET refunded_at = ? WHERE order_id = ? AND refunded_at IS NULL").bind(nowIso(), orderId).run();

// ---------------------------------------------------------------- relatórios

/** Período dos relatórios: `yyyy-MM` (um mês) ou `all`. Padrão: o mês atual. */
export function parsePeriod(value: string | undefined) {
  if (value === "all") return { period: "all", from: "2000-01-01", to: "2100-01-01" };
  const month = value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : reportDay().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { period: month, from: `${month}-01`, to: `${next}-01` };
}

/** Início de um dia do relatório (`yyyy-MM-dd`, horário de Brasília) em ISO UTC. */
const dayStartUtc = (day: string) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - REPORT_OFFSET_HOURS * 3_600_000).toISOString();

export type AffiliateStats = {
  clicks: number;
  installs: number;
  signups: number;
  activated: number;
  payments: number;
  payingUsers: number;
  grossCents: number;
  netCents: number;
  commissionCents: number;
  refunds: number;
  testPayments: number;
  activeSubscribers: number;
};

const emptyStats = (): AffiliateStats => ({
  clicks: 0,
  installs: 0,
  signups: 0,
  activated: 0,
  payments: 0,
  payingUsers: 0,
  grossCents: 0,
  netCents: 0,
  commissionCents: 0,
  refunds: 0,
  testPayments: 0,
  activeSubscribers: 0,
});

/** Funil de cada parceiro no período: cliques → instalações → cadastros → 1ª identificação → pagamentos. */
export async function affiliateStats(db: D1Database, range: { from: string; to: string }, affiliateId?: string) {
  const fromIso = dayStartUtc(range.from);
  const toIso = dayStartUtc(range.to);
  const only = affiliateId ? "AND affiliate_id = ?" : "AND affiliate_id IS NOT NULL";
  const extra = affiliateId ? [affiliateId] : [];
  const now = nowIso();

  type Row = { affiliate_id: string } & Record<string, number>;
  const query = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).bind(...params, ...extra).all<Row>().then((r) => r.results);

  const [clicks, installs, signups, activated, payments, refunds, active] = await Promise.all([
    query(`SELECT affiliate_id, SUM(clicks) AS n FROM affiliate_clicks WHERE day >= ? AND day < ? ${only} GROUP BY affiliate_id`, range.from, range.to),
    query(`SELECT affiliate_id, COUNT(*) AS n FROM app_installs WHERE created_at >= ? AND created_at < ? ${only} GROUP BY affiliate_id`, fromIso, toIso),
    query(`SELECT affiliate_id, COUNT(*) AS n FROM referrals WHERE created_at >= ? AND created_at < ? ${only} GROUP BY affiliate_id`, fromIso, toIso),
    query(`SELECT affiliate_id, COUNT(*) AS n FROM referrals WHERE rewarded_at >= ? AND rewarded_at < ? ${only} GROUP BY affiliate_id`, fromIso, toIso),
    query(
      `SELECT affiliate_id, SUM(test = 0) AS payments, COUNT(DISTINCT CASE WHEN test = 0 THEN user_id END) AS paying,
         SUM(CASE WHEN test = 0 THEN amount_cents ELSE 0 END) AS gross, SUM(CASE WHEN test = 0 THEN net_cents ELSE 0 END) AS net,
         SUM(CASE WHEN test = 0 THEN commission_cents ELSE 0 END) AS commission, SUM(test) AS tests
       FROM payments WHERE paid_at >= ? AND paid_at < ? AND refunded_at IS NULL ${only} GROUP BY affiliate_id`,
      fromIso,
      toIso,
    ),
    query(`SELECT affiliate_id, COUNT(*) AS n FROM payments WHERE refunded_at >= ? AND refunded_at < ? ${only} GROUP BY affiliate_id`, fromIso, toIso),
    // Agora, independente do período: indicados com assinatura paga vigente.
    query(
      `SELECT r.affiliate_id, COUNT(*) AS n FROM referrals r JOIN subscriptions s ON s.user_id = r.referee_id
       WHERE s.plan != 'free' AND (s.renews_at IS NULL OR s.renews_at > ?) ${only.replace("affiliate_id", "r.affiliate_id")}
       GROUP BY r.affiliate_id`,
      now,
    ),
  ]);

  const stats = new Map<string, AffiliateStats>();
  const of = (id: string) => stats.get(id) ?? stats.set(id, emptyStats()).get(id)!;
  for (const r of clicks) of(r.affiliate_id).clicks = r.n;
  for (const r of installs) of(r.affiliate_id).installs = r.n;
  for (const r of signups) of(r.affiliate_id).signups = r.n;
  for (const r of activated) of(r.affiliate_id).activated = r.n;
  for (const r of refunds) of(r.affiliate_id).refunds = r.n;
  for (const r of active) of(r.affiliate_id).activeSubscribers = r.n;
  for (const r of payments) {
    Object.assign(of(r.affiliate_id), {
      payments: r.payments ?? 0,
      payingUsers: r.paying ?? 0,
      grossCents: r.gross ?? 0,
      netCents: r.net ?? 0,
      commissionCents: r.commission ?? 0,
      testPayments: r.tests ?? 0,
    });
  }
  return { get: (id: string) => stats.get(id) ?? emptyStats() };
}

/** Comissão acumulada (desde sempre), já paga e a pagar. */
export async function affiliateBalances(db: D1Database, affiliateId?: string) {
  const only = affiliateId ? "AND affiliate_id = ?" : "AND affiliate_id IS NOT NULL";
  const extra = affiliateId ? [affiliateId] : [];
  const [earned, paid] = await Promise.all([
    db
      .prepare(
        `SELECT affiliate_id, SUM(commission_cents) AS n FROM payments
         WHERE test = 0 AND refunded_at IS NULL ${only} GROUP BY affiliate_id`,
      )
      .bind(...extra)
      .all<{ affiliate_id: string; n: number }>(),
    db
      .prepare(`SELECT affiliate_id, SUM(amount_cents) AS n FROM affiliate_payouts WHERE 1 = 1 ${only} GROUP BY affiliate_id`)
      .bind(...extra)
      .all<{ affiliate_id: string; n: number }>(),
  ]);
  const earnedBy = new Map(earned.results.map((r) => [r.affiliate_id, r.n]));
  const paidBy = new Map(paid.results.map((r) => [r.affiliate_id, r.n]));
  return {
    get(id: string) {
      const commissionCents = earnedBy.get(id) ?? 0;
      const paidCents = paidBy.get(id) ?? 0;
      return { commissionCents, paidCents, dueCents: commissionCents - paidCents };
    },
  };
}

/** Evolução mês a mês dos últimos [months] meses (mais recente primeiro). */
export async function affiliateMonthly(db: D1Database, affiliateId: string, months = 12) {
  const shift = `'${REPORT_OFFSET_HOURS} hours'`;
  const month = (col: string) => `substr(datetime(${col}, ${shift}), 1, 7)`;
  type Row = { month: string } & Record<string, number>;
  const q = (sql: string) => db.prepare(sql).bind(affiliateId).all<Row>().then((r) => r.results);

  const [clicks, installs, signups, payments] = await Promise.all([
    q("SELECT substr(day, 1, 7) AS month, SUM(clicks) AS n FROM affiliate_clicks WHERE affiliate_id = ? GROUP BY month"),
    q(`SELECT ${month("created_at")} AS month, COUNT(*) AS n FROM app_installs WHERE affiliate_id = ? GROUP BY month`),
    q(`SELECT ${month("created_at")} AS month, COUNT(*) AS n FROM referrals WHERE affiliate_id = ? GROUP BY month`),
    q(
      `SELECT ${month("paid_at")} AS month, COUNT(*) AS payments, SUM(net_cents) AS net, SUM(commission_cents) AS commission
       FROM payments WHERE affiliate_id = ? AND test = 0 AND refunded_at IS NULL GROUP BY month`,
    ),
  ]);

  const rows = new Map<string, { month: string; clicks: number; installs: number; signups: number; payments: number; netCents: number; commissionCents: number }>();
  const now = new Date(reportDay() + "T12:00:00.000Z");
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    rows.set(key, { month: key, clicks: 0, installs: 0, signups: 0, payments: 0, netCents: 0, commissionCents: 0 });
  }
  for (const r of clicks) if (rows.has(r.month)) rows.get(r.month)!.clicks = r.n;
  for (const r of installs) if (rows.has(r.month)) rows.get(r.month)!.installs = r.n;
  for (const r of signups) if (rows.has(r.month)) rows.get(r.month)!.signups = r.n;
  for (const r of payments) {
    if (rows.has(r.month)) Object.assign(rows.get(r.month)!, { payments: r.payments, netCents: r.net, commissionCents: r.commission });
  }
  return [...rows.values()];
}
