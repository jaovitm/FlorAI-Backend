import { describe, expect, it } from "vitest";
import { api, createCollection, createPlant, insertIdentification, sampleCare, setPlan, signup } from "../helpers";

describe("/plants", () => {
  it("salva uma identificação numa coleção copiando os dados", async () => {
    const { token, user } = await signup();
    const collectionId = await createCollection(token);
    const identificationId = await insertIdentification(user.id);

    const res = await api("POST", "/plants", { token, body: { identificationId, collectionId } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      id: expect.stringMatching(/^plt_/),
      collectionId,
      identificationId,
      plantName: "Jiboia",
      scientificName: "Epipremnum aureum",
      careInstructions: sampleCare,
      curiosities: ["Purifica o ar"],
    });
    expect((await api("GET", "/plants", { token })).json.items).toHaveLength(1);
  });

  it.each([
    [{ collectionId: "col_x" }, "Informe a identificação."],
    [{ identificationId: "idn_x" }, "Informe a coleção."],
    [{ identificationId: " ", collectionId: "col_x" }, "Informe a identificação."],
  ])("valida o corpo (caso %#)", async (body, message) => {
    const { token } = await signup();
    const res = await api("POST", "/plants", { token, body });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe(message);
  });

  it("404 quando identificação ou coleção não pertencem ao usuário", async () => {
    const a = await signup();
    const b = await signup();
    const colA = await createCollection(a.token);
    const idnA = await insertIdentification(a.user.id);
    const colB = await createCollection(b.token);
    const idnB = await insertIdentification(b.user.id);

    let res = await api("POST", "/plants", { token: a.token, body: { identificationId: idnB, collectionId: colA } });
    expect(res.status).toBe(404);
    expect(res.json.error.message).toBe("Identificação não encontrada.");

    res = await api("POST", "/plants", { token: a.token, body: { identificationId: idnA, collectionId: colB } });
    expect(res.status).toBe(404);
    expect(res.json.error.message).toBe("Coleção não encontrada.");
  });

  it("plano free permite até 3 plantas; basic libera mais", async () => {
    const { token, user } = await signup();
    const collectionId = await createCollection(token);
    for (let i = 0; i < 3; i++) await createPlant(token, user.id, collectionId);

    const identificationId = await insertIdentification(user.id);
    const res = await api("POST", "/plants", { token, body: { identificationId, collectionId } });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatchObject({ code: "plan_limit", feature: "plants", plan: "free" });
    expect(res.json.error.message).toBe("Seu plano permite até 3 plantas. Faça upgrade para salvar mais.");

    await setPlan(token, "basic");
    expect((await api("POST", "/plants", { token, body: { identificationId, collectionId } })).status).toBe(201);
  });

  it("PATCH move a planta para outra coleção do usuário", async () => {
    const { token, user } = await signup();
    await setPlan(token, "basic");
    const { plantId } = await createPlant(token, user.id);
    const other = await createCollection(token, "Outra");

    const res = await api("PATCH", `/plants/${plantId}`, { token, body: { collectionId: other } });
    expect(res.status).toBe(200);
    expect(res.json.collectionId).toBe(other);

    expect((await api("PATCH", `/plants/${plantId}`, { token, body: { collectionId: "col_x" } })).json.error.message).toBe(
      "Coleção não encontrada.",
    );
    expect((await api("PATCH", "/plants/plt_x", { token, body: { collectionId: other } })).json.error.message).toBe(
      "Planta não encontrada.",
    );
    expect((await api("PATCH", `/plants/${plantId}`, { token, body: {} })).status).toBe(400);
  });

  it("DELETE remove a planta e o lembrete dela", async () => {
    const { token, user } = await signup();
    await setPlan(token, "basic");
    const { plantId } = await createPlant(token, user.id);
    await api("PUT", "/reminders/rem-p", { token, body: { plantId, intervalDays: 2, hour: 9, minute: 0 } });

    expect((await api("DELETE", `/plants/${plantId}`, { token })).status).toBe(204);
    expect((await api("GET", "/reminders", { token })).json.items).toEqual([]);
    expect((await api("DELETE", `/plants/${plantId}`, { token })).status).toBe(404);
  });

  it("outro usuário não consegue apagar a planta", async () => {
    const a = await signup();
    const b = await signup();
    const { plantId } = await createPlant(a.token, a.user.id);
    expect((await api("DELETE", `/plants/${plantId}`, { token: b.token })).status).toBe(404);
    expect((await api("GET", "/plants", { token: a.token })).json.items).toHaveLength(1);
  });
});
