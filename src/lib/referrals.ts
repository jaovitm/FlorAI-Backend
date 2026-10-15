import type { UserRow } from "../types/env";
import { randomBytes } from "./crypto";
import { validationError } from "./errors";
import { addDays, nowIso } from "./http";
import { BONUS_PLAN } from "./plans";

/** Dias de Pro que cada lado ganha por indicação de amigo confirmada. */
export const REWARD_DAYS = 7;
export const REWARD_PLAN = BONUS_PLAN;
/** Recompensas que uma mesma pessoa pode ganhar indicando (o indicado ganha sempre). */
export const MAX_REFERRER_REWARDS = 10;
/** Prazo, desde o cadastro, para informar um código depois de criar a conta. */
export const REDEEM_WINDOW_DAYS = 7;

// Sem 0/O e 1/I, que se confundem ao digitar.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
/** Códigos aceitos na busca: de amigo (6 caracteres) ou cupom de influenciador (3 a 20). */
const ANY_CODE_RE = /^[A-Z0-9]{3,20}$/;

export function newReferralCode() {
  return [...randomBytes(CODE_LENGTH)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Aceita minúsculas, espaços e hífens (`k7p-2qm` → `K7P2QM`). */
export const normalizeReferralCode = (value: string) => value.toUpperCase().replace(/[\s-]/g, "");

/** Código do usuário, criado na hora para contas anteriores ao programa. */
export async function ensureReferralCode(db: D1Database, user: UserRow) {
  if (user.referral_code) return user.referral_code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    // Não pode coincidir com o cupom de um influenciador.
    if (await db.prepare("SELECT 1 FROM affiliates WHERE code = ?").bind(code).first()) continue;
    try {
      const saved = await db
        .prepare("UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL RETURNING referral_code")
        .bind(code, user.id)
        .first<string>("referral_code");
      // Outra requisição criou o código antes: usa o dela.
      user.referral_code =
        saved ?? (await db.prepare("SELECT referral_code FROM users WHERE id = ?").bind(user.id).first<string>("referral_code"));
      return user.referral_code!;
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err; // colisão de código: tenta outro
    }
  }
  throw new Error("Não foi possível gerar um código de indicação único.");
}

/** De onde veio o código: um amigo ou um influenciador. */
export type CodeOwner = { referrerId: string; affiliateId?: never } | { affiliateId: string; referrerId?: never };

/**
 * Confere o código (de amigo ou cupom de influenciador). Não grava nada: o cadastro usa
 * isso antes de criar a conta, para recusar um código errado sem deixar conta pela metade.
 */
export async function resolveCode(db: D1Database, rawCode: string, refereeId?: string): Promise<CodeOwner> {
  const code = normalizeReferralCode(rawCode);
  if (!ANY_CODE_RE.test(code)) throw validationError("Código inválido. Confira e tente de novo.");

  const affiliate = await db
    .prepare("SELECT id, active FROM affiliates WHERE code = ?")
    .bind(code)
    .first<{ id: string; active: number }>();
  if (affiliate) {
    if (!affiliate.active) throw validationError("Este cupom não está mais ativo.");
    return { affiliateId: affiliate.id };
  }

  const referrerId = await db.prepare("SELECT id FROM users WHERE referral_code = ?").bind(code).first<string>("id");
  if (!referrerId) throw validationError("Não encontramos esse código. Confira e tente de novo.");
  if (referrerId === refereeId) throw validationError("Você não pode usar o seu próprio código.");
  return { referrerId };
}

export const insertReferral = (db: D1Database, refereeId: string, owner: CodeOwner, now = nowIso()) =>
  db
    .prepare(
      `INSERT INTO referrals (referee_id, referrer_id, affiliate_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT (referee_id) DO NOTHING`,
    )
    .bind(refereeId, owner.referrerId ?? null, owner.affiliateId ?? null, now);

/** Código informado depois do cadastro (`POST /referrals/redeem`). */
export async function redeemReferralCode(db: D1Database, user: UserRow, rawCode: string) {
  if (addDays(new Date(user.created_at), REDEEM_WINDOW_DAYS).toISOString() < nowIso()) {
    throw validationError(`O código só pode ser usado nos primeiros ${REDEEM_WINDOW_DAYS} dias de conta.`);
  }
  const used = await db.prepare("SELECT 1 FROM referrals WHERE referee_id = ?").bind(user.id).first();
  if (used) throw validationError("Você já usou um código.");

  const owner = await resolveCode(db, rawCode, user.id);
  if (owner.referrerId) {
    // Duas contas indicando uma à outra.
    const mutual = await db
      .prepare("SELECT 1 FROM referrals WHERE referee_id = ? AND referrer_id = ?")
      .bind(owner.referrerId, user.id)
      .first();
    if (mutual) throw validationError("Quem você indicou não pode ser a pessoa que indica você.");
  }

  const { meta } = await insertReferral(db, user.id, owner).run();
  if (meta.changes === 0) throw validationError("Você já usou um código.");

  // Quem já identificou uma planta cumpre a condição na hora.
  const identified = await db.prepare("SELECT 1 FROM identifications WHERE user_id = ? LIMIT 1").bind(user.id).first();
  if (identified) await rewardReferral(db, user.id);
}

/**
 * Entrega a recompensa quando o indicado conclui a 1ª identificação: dias de Pro para ele
 * e, se veio de um amigo, para o amigo também. Idempotente e seguro com chamadas
 * simultâneas: tudo roda numa transação e cada passo só age enquanto a indicação está `pending`.
 */
export async function rewardReferral(db: D1Database, refereeId: string) {
  const pending = await db
    .prepare(
      `SELECT r.referrer_id, a.bonus_days FROM referrals r LEFT JOIN affiliates a ON a.id = r.affiliate_id
       WHERE r.referee_id = ? AND r.status = 'pending'`,
    )
    .bind(refereeId)
    .first<{ referrer_id: string | null; bonus_days: number | null }>();
  if (!pending) return;

  const now = nowIso();
  const referrerId = pending.referrer_id;
  const refereeDays = referrerId ? REWARD_DAYS : (pending.bonus_days ?? 0);
  const isPending = "EXISTS (SELECT 1 FROM referrals WHERE referee_id = ?1 AND status = 'pending')";
  const referrerUnderLimit = `(SELECT COUNT(*) FROM referrals WHERE referrer_id = ?2 AND referrer_rewarded = 1) < ${MAX_REFERRER_REWARDS}`;
  // Soma os dias a partir do fim do bônus atual, ou de agora se ele já venceu.
  const extend = `bonus_pro_until = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(COALESCE(bonus_pro_until, ?3), ?3), '+' || ?4 || ' days')`;

  const statements: D1PreparedStatement[] = [];
  if (refereeDays > 0) {
    statements.push(
      db.prepare(`UPDATE users SET ${extend} WHERE id = ?1 AND ${isPending}`).bind(refereeId, referrerId, now, refereeDays),
    );
  }
  if (referrerId) {
    statements.push(
      db
        .prepare(`UPDATE users SET ${extend} WHERE id = ?2 AND ${isPending} AND ${referrerUnderLimit}`)
        .bind(refereeId, referrerId, now, REWARD_DAYS),
      db
        .prepare(
          `UPDATE referrals SET status = 'rewarded', rewarded_at = ?3,
             referrer_rewarded = CASE WHEN ${referrerUnderLimit} THEN 1 ELSE 0 END
           WHERE referee_id = ?1 AND status = 'pending'`,
        )
        .bind(refereeId, referrerId, now),
    );
  } else {
    statements.push(
      db
        .prepare("UPDATE referrals SET status = 'rewarded', rewarded_at = ?2 WHERE referee_id = ?1 AND status = 'pending'")
        .bind(refereeId, now),
    );
  }
  await db.batch(statements);
}

/** Resumo exibido na tela "Indique e ganhe" (`GET /referrals`). */
export async function referralSummary(db: D1Database, user: UserRow, packageName: string) {
  const code = await ensureReferralCode(db, user);
  const [stats, own] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS invited,
           COALESCE(SUM(status = 'rewarded'), 0) AS confirmed,
           COALESCE(SUM(referrer_rewarded), 0) AS rewarded
         FROM referrals WHERE referrer_id = ?`,
      )
      .bind(user.id)
      .first<{ invited: number; confirmed: number; rewarded: number }>(),
    db
      .prepare(
        `SELECT r.status, r.referrer_id, a.bonus_days FROM referrals r LEFT JOIN affiliates a ON a.id = r.affiliate_id
         WHERE r.referee_id = ?`,
      )
      .bind(user.id)
      .first<{ status: string; referrer_id: string | null; bonus_days: number | null }>(),
  ]);
  const now = nowIso();
  const withinWindow = addDays(new Date(user.created_at), REDEEM_WINDOW_DAYS).toISOString() >= now;

  return {
    code,
    link: playStoreLink(packageName, code, { utm_source: "florai", utm_medium: "referral", utm_campaign: "indique-e-ganhe" }),
    rewardDays: REWARD_DAYS,
    rewardPlan: REWARD_PLAN,
    maxRewards: MAX_REFERRER_REWARDS,
    invited: stats?.invited ?? 0,
    confirmed: stats?.confirmed ?? 0,
    rewarded: stats?.rewarded ?? 0,
    bonusUntil: user.bonus_pro_until && user.bonus_pro_until > now ? user.bonus_pro_until : null,
    // Código que este usuário usou (de amigo ou cupom): null, "pending" ou "rewarded".
    ownReferral: own?.status ?? null,
    // Dias de Pro que esse código dá a ele (o cupom de cada influenciador pode ser diferente).
    ownRewardDays: own ? (own.referrer_id ? REWARD_DAYS : (own.bonus_days ?? 0)) : null,
    canRedeem: !own && withinWindow,
  };
}

/**
 * Link da Play Store com o código no `referrer`. O app lê com a Install Referrer API
 * na primeira abertura e preenche o código no cadastro. Os `utm_*` aparecem nos
 * relatórios de aquisição do Play Console.
 */
export function playStoreLink(packageName: string, code: string, utm: Record<string, string>) {
  const referrer = new URLSearchParams({ ...utm, ref: code }).toString();
  const url = new URL("https://play.google.com/store/apps/details");
  url.searchParams.set("id", packageName);
  url.searchParams.set("referrer", referrer);
  return url.toString();
}
