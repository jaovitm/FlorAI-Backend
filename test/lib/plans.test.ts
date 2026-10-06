import { describe, expect, it } from "vitest";
import { getPlan, isPlan, PLAN_LIMITS } from "../../src/lib/plans";
import { env, setPlan, signup } from "../helpers";

describe("plans", () => {
  it("isPlan valida apenas planos conhecidos", () => {
    for (const p of ["free", "basic", "pro", "premium"]) expect(isPlan(p)).toBe(true);
    expect(isPlan("gold")).toBe(false);
    expect(isPlan(undefined)).toBe(false);
  });

  it("limites seguem a tabela de planos", () => {
    expect(PLAN_LIMITS.free).toEqual({
      dailyIdentifications: 3,
      collections: 1,
      plants: 3,
      wateringAlerts: false,
      aiDoctor: false,
    });
    expect(PLAN_LIMITS.basic.plants).toBe(20);
    expect(PLAN_LIMITS.pro.plants).toBe(Infinity);
    expect(PLAN_LIMITS.premium.dailyIdentifications).toBe(40);
    expect(PLAN_LIMITS.premium.aiDoctor).toBe(true);
  });

  it("getPlan lê do D1 e cai para free sem assinatura", async () => {
    const { token, user } = await signup();
    expect(await getPlan(env.DB, user.id)).toBe("free");
    await setPlan(token, "pro");
    expect(await getPlan(env.DB, user.id)).toBe("pro");
    expect(await getPlan(env.DB, "usr_inexistente")).toBe("free");
  });
});
