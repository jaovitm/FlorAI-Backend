import { afterEach, describe, expect, it, vi } from "vitest";
import { api, env, signup } from "../helpers";

describe("/subscription", () => {
  it("usuário novo começa no free sem renovação", async () => {
    const { token } = await signup();
    const res = await api("GET", "/subscription", { token });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ plan: "free", renewsAt: null });
  });

  it("sem linha de assinatura, trata como free desde o cadastro", async () => {
    const { token, user } = await signup();
    await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ?").bind(user.id).run();
    const res = await api("GET", "/subscription", { token });
    expect(res.json).toEqual({ plan: "free", startedAt: user.createdAt, renewsAt: null, storePlan: "free", bonusUntil: null });
  });

  it("POST troca de plano; pagos renovam em 30 dias", async () => {
    const { token } = await signup();
    const res = await api("POST", "/subscription", { token, body: { plan: "pro" } });
    expect(res.status).toBe(200);
    expect(res.json.plan).toBe("pro");
    const days = (Date.parse(res.json.renewsAt) - Date.parse(res.json.startedAt)) / 86_400_000;
    expect(days).toBe(30);

    const back = await api("POST", "/subscription", { token, body: { plan: "free" } });
    expect(back.json).toMatchObject({ plan: "free", renewsAt: null });
    expect((await api("GET", "/subscription", { token })).json.plan).toBe("free");
  });

  it("recria a assinatura se a linha não existir", async () => {
    const { token, user } = await signup();
    await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ?").bind(user.id).run();
    expect((await api("POST", "/subscription", { token, body: { plan: "basic" } })).json.plan).toBe("basic");
  });

  it.each([{ plan: "gold" }, {}, { plan: 1 }])("rejeita plano inválido %j", async (body) => {
    const { token } = await signup();
    const res = await api("POST", "/subscription", { token, body });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe("Plano inválido.");
  });
});

describe("GET /usage/today", () => {
  afterEach(() => vi.useRealTimers());

  it("retorna 0 sem uso e o contador do dia local", async () => {
    const { token, user } = await signup();
    let res = await api("GET", "/usage/today", { token, headers: { "X-Timezone-Offset": "0" } });
    expect(res.json).toEqual({ day: new Date().toISOString().slice(0, 10), identifications: 0 });

    await env.DB.prepare("INSERT INTO daily_usage (user_id, day, identifications) VALUES (?, ?, 2)")
      .bind(user.id, res.json.day)
      .run();
    res = await api("GET", "/usage/today", { token });
    expect(res.json.identifications).toBe(2);
  });

  it("usa o fuso do usuário para definir o dia", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T02:00:00Z"));
    const { token } = await signup();
    const res = await api("GET", "/usage/today", { token, headers: { "X-Timezone-Offset": "-180" } });
    expect(res.json.day).toBe("2026-06-14");
  });
});
