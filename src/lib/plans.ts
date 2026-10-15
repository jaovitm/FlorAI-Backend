export const PLANS = ["free", "basic", "pro", "premium"] as const;
export type Plan = (typeof PLANS)[number];

export type Feature = "dailyIdentifications" | "collections" | "plants" | "wateringAlerts" | "aiDoctor";

type Limits = {
  dailyIdentifications: number;
  collections: number;
  plants: number;
  wateringAlerts: boolean;
  aiDoctor: boolean;
};

export const PLAN_LIMITS: Record<Plan, Limits> = {
  free: { dailyIdentifications: 3, collections: 1, plants: 3, wateringAlerts: false, aiDoctor: false },
  basic: { dailyIdentifications: 5, collections: Infinity, plants: 20, wateringAlerts: true, aiDoctor: false },
  pro: { dailyIdentifications: 15, collections: Infinity, plants: Infinity, wateringAlerts: true, aiDoctor: false },
  premium: { dailyIdentifications: 40, collections: Infinity, plants: Infinity, wateringAlerts: true, aiDoctor: true },
};

export const isPlan = (value: unknown): value is Plan =>
  typeof value === "string" && (PLANS as readonly string[]).includes(value);

/** Plano dado pelo bônus de indicação (`users.bonus_pro_until`). */
export const BONUS_PLAN: Plan = "pro";

/** Plano em vigor: o maior entre o da loja e o do bônus de indicação, se ainda vale. */
export function effectivePlan(storePlan: Plan, bonusUntil: string | null, now = new Date().toISOString()): Plan {
  if (!bonusUntil || bonusUntil <= now) return storePlan;
  return PLANS.indexOf(BONUS_PLAN) > PLANS.indexOf(storePlan) ? BONUS_PLAN : storePlan;
}

/** Plano em vigor do usuário (ver `effectivePlan`). */
export async function getPlan(db: D1Database, userId: string): Promise<Plan> {
  const row = await db
    .prepare(
      `SELECT s.plan, u.bonus_pro_until FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = ?`,
    )
    .bind(userId)
    .first<{ plan: string | null; bonus_pro_until: string | null }>();
  return effectivePlan(isPlan(row?.plan) ? row.plan : "free", row?.bonus_pro_until ?? null);
}

/** Preço mensal de cada plano em centavos (Google Play, Brasil). Mantenha igual ao Play Console. */
export const PLAN_PRICE_CENTS: Record<Exclude<Plan, "free">, number> = { basic: 999, pro: 1999, premium: 4999 };

/** Taxa do Google sobre assinaturas. Receita líquida = preço × (1 − taxa). */
export const GOOGLE_FEE = 0.15;
