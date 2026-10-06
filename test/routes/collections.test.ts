import { describe, expect, it } from "vitest";
import { api, createCollection, createPlant, env, setPlan, signup } from "../helpers";

describe("/collections", () => {
  it("cria e lista coleções em ordem de criação", async () => {
    const { token } = await signup();
    await setPlan(token, "basic");
    const created = await api("POST", "/collections", { token, body: { name: "  Sala  " } });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ id: expect.stringMatching(/^col_/), name: "Sala" });
    await createCollection(token, "Varanda");

    const list = await api("GET", "/collections", { token });
    expect(list.json.items.map((c: any) => c.name)).toEqual(["Sala", "Varanda"]);
  });

  it.each([
    [{}, "Dê um nome para a coleção."],
    [{ name: "   " }, "Dê um nome para a coleção."],
    [{ name: "x".repeat(31) }, "O nome da coleção pode ter no máximo 30 caracteres."],
  ])("valida o nome (caso %#)", async (body, message) => {
    const { token } = await signup();
    const res = await api("POST", "/collections", { token, body });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe(message);
  });

  it("plano free permite só 1 coleção", async () => {
    const { token } = await signup();
    await createCollection(token);
    const res = await api("POST", "/collections", { token, body: { name: "Outra" } });
    expect(res.status).toBe(403);
    expect(res.json.error).toEqual({
      code: "plan_limit",
      message: "Seu plano permite 1 coleção. Faça upgrade para criar mais.",
      feature: "collections",
      plan: "free",
    });
  });

  it("planos pagos não têm limite de coleções", async () => {
    const { token } = await signup();
    await setPlan(token, "basic");
    for (let i = 0; i < 5; i++) await createCollection(token, `C${i}`);
    expect((await api("GET", "/collections", { token })).json.items).toHaveLength(5);
  });

  it("usuário não vê nem altera coleções de outro", async () => {
    const a = await signup();
    const b = await signup();
    const id = await createCollection(a.token);

    expect((await api("GET", "/collections", { token: b.token })).json.items).toEqual([]);
    expect((await api("PATCH", `/collections/${id}`, { token: b.token, body: { name: "X" } })).status).toBe(404);
    expect((await api("DELETE", `/collections/${id}`, { token: b.token })).status).toBe(404);
  });

  it("PATCH renomeia", async () => {
    const { token } = await signup();
    const id = await createCollection(token);
    const res = await api("PATCH", `/collections/${id}`, { token, body: { name: "Quarto" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id, name: "Quarto" });
    expect((await api("PATCH", "/collections/col_nao_existe", { token, body: { name: "X" } })).status).toBe(404);
  });

  it("DELETE remove a coleção com suas plantas e lembretes", async () => {
    const { token, user } = await signup();
    await setPlan(token, "basic");
    const { plantId, collectionId } = await createPlant(token, user.id);
    await api("PUT", "/reminders/rem-1", { token, body: { plantId, intervalDays: 3, hour: 8, minute: 0 } });

    const res = await api("DELETE", `/collections/${collectionId}`, { token });
    expect(res.status).toBe(204);
    expect((await api("GET", "/collections", { token })).json.items).toEqual([]);
    expect((await api("GET", "/plants", { token })).json.items).toEqual([]);
    const reminders = await env.DB.prepare("SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?")
      .bind(user.id)
      .first<number>("n");
    expect(reminders).toBe(0);
    expect((await api("DELETE", `/collections/${collectionId}`, { token })).status).toBe(404);
  });
});
