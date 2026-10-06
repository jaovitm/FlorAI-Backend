import { describe, expect, it } from "vitest";
import { api, createCollection, createPlant, setPlan, signup } from "../helpers";

const body = (plantId: string, extra: Record<string, unknown> = {}) => ({
  plantId,
  intervalDays: 3,
  hour: 8,
  minute: 30,
  ...extra,
});

async function paidUserWithPlant() {
  const u = await signup();
  await setPlan(u.token, "basic");
  const { plantId, collectionId } = await createPlant(u.token, u.user.id);
  return { ...u, plantId, collectionId };
}

describe("/reminders", () => {
  it("plano free não pode criar lembretes", async () => {
    const { token, user } = await signup();
    const { plantId } = await createPlant(token, user.id);
    const res = await api("PUT", "/reminders/r1", { token, body: body(plantId) });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatchObject({ code: "plan_limit", feature: "wateringAlerts", plan: "free" });
  });

  it("PUT cria (upsert) com id do app e normaliza datas", async () => {
    const { token, plantId } = await paidUserWithPlant();
    const res = await api("PUT", "/reminders/r-app-1", {
      token,
      body: body(plantId, { lastWateredAt: "2026-05-01T10:00:00-03:00", createdAt: "2026-04-01T00:00:00Z" }),
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      id: "r-app-1",
      plantId,
      intervalDays: 3,
      hour: 8,
      minute: 30,
      lastWateredAt: "2026-05-01T13:00:00.000Z",
      createdAt: "2026-04-01T00:00:00.000Z",
    });
  });

  it("PUT no mesmo id atualiza e preserva createdAt", async () => {
    const { token, plantId } = await paidUserWithPlant();
    const first = await api("PUT", "/reminders/r2", { token, body: body(plantId) });
    const second = await api("PUT", "/reminders/r2", {
      token,
      body: body(plantId, { intervalDays: 10, createdAt: "2020-01-01T00:00:00Z" }),
    });
    expect(second.json.intervalDays).toBe(10);
    expect(second.json.createdAt).toBe(first.json.createdAt);
    expect((await api("GET", "/reminders", { token })).json.items).toHaveLength(1);
  });

  it("um lembrete por planta: novo id substitui o anterior", async () => {
    const { token, plantId } = await paidUserWithPlant();
    await api("PUT", "/reminders/old", { token, body: body(plantId) });
    await api("PUT", "/reminders/new", { token, body: body(plantId) });
    const items = (await api("GET", "/reminders", { token })).json.items;
    expect(items.map((r: any) => r.id)).toEqual(["new"]);
  });

  it.each([
    [{ intervalDays: 0 }, "O intervalo deve ser de 1 a 60 dias."],
    [{ intervalDays: 61 }, "O intervalo deve ser de 1 a 60 dias."],
    [{ intervalDays: 1.5 }, "O intervalo deve ser de 1 a 60 dias."],
    [{ hour: 24 }, "Horário inválido."],
    [{ minute: -1 }, "Horário inválido."],
    [{ minute: "10" }, "Horário inválido."],
    [{ lastWateredAt: "ontem" }, "Data da última rega inválida."],
  ])("valida o corpo (caso %#)", async (extra, message) => {
    const { token, plantId } = await paidUserWithPlant();
    const res = await api("PUT", "/reminders/r3", { token, body: body(plantId, extra) });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe(message);
  });

  it("rejeita id longo demais", async () => {
    const { token, plantId } = await paidUserWithPlant();
    const res = await api("PUT", `/reminders/${"x".repeat(101)}`, { token, body: body(plantId) });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe("Identificador do lembrete inválido.");
  });

  it("404 para planta inexistente ou de outro usuário", async () => {
    const a = await paidUserWithPlant();
    const b = await paidUserWithPlant();
    expect((await api("PUT", "/reminders/r4", { token: a.token, body: body("plt_x") })).status).toBe(404);
    expect((await api("PUT", "/reminders/r4", { token: a.token, body: body(b.plantId) })).status).toBe(404);
  });

  it("id já usado por outro usuário retorna 404 sem vazar dados", async () => {
    const a = await paidUserWithPlant();
    const b = await paidUserWithPlant();
    await api("PUT", "/reminders/shared-id", { token: a.token, body: body(a.plantId) });
    const res = await api("PUT", "/reminders/shared-id", { token: b.token, body: body(b.plantId) });
    expect(res.status).toBe(404);
    expect(res.json.error.message).toBe("Lembrete não encontrado.");
    expect((await api("GET", "/reminders", { token: a.token })).json.items[0].plantId).toBe(a.plantId);
  });

  it("DELETE remove só lembretes do próprio usuário", async () => {
    const a = await paidUserWithPlant();
    const b = await paidUserWithPlant();
    await api("PUT", "/reminders/del-1", { token: a.token, body: body(a.plantId) });

    expect((await api("DELETE", "/reminders/del-1", { token: b.token })).status).toBe(404);
    expect((await api("DELETE", "/reminders/del-1", { token: a.token })).status).toBe(204);
    expect((await api("DELETE", "/reminders/del-1", { token: a.token })).status).toBe(404);
  });

  it("lista vazia para usuário novo", async () => {
    const { token } = await signup();
    await createCollection(token);
    expect((await api("GET", "/reminders", { token })).json).toEqual({ items: [] });
  });
});
