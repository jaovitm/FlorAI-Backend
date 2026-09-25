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

export async function getPlan(db: D1Database, userId: string): Promise<Plan> {
  const row = await db
    .prepare("SELECT plan FROM subscriptions WHERE user_id = ?")
    .bind(userId)
    .first<{ plan: string }>();
  return isPlan(row?.plan) ? row.plan : "free";
}
