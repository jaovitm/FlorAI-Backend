import { describe, expect, it } from "vitest";
import { api, signup } from "../helpers";

describe("/me", () => {
  it("GET devolve o usuário logado", async () => {
    const { token, user } = await signup({ name: "Bia" });
    const res = await api("GET", "/me", { token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual(user);
  });

  it("PATCH atualiza nome, displayName e onboarding", async () => {
    const { token } = await signup();
    const res = await api("PATCH", "/me", {
      token,
      body: { name: " Nova ", displayName: " Nô ", hasCompletedOnboarding: true },
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: "Nova", displayName: "Nô", hasCompletedOnboarding: true });
    expect((await api("GET", "/me", { token })).json).toMatchObject({ name: "Nova", displayName: "Nô" });
  });

  it("PATCH parcial mantém os outros campos; displayName vazio ou null vira null", async () => {
    const { token } = await signup({ name: "Carla" });
    await api("PATCH", "/me", { token, body: { displayName: "Ca" } });
    const res = await api("PATCH", "/me", { token, body: { displayName: "   " } });
    expect(res.json).toMatchObject({ name: "Carla", displayName: null });

    await api("PATCH", "/me", { token, body: { displayName: "Ca" } });
    const cleared = await api("PATCH", "/me", { token, body: { displayName: null } });
    expect(cleared.json.displayName).toBeNull();
  });

  it.each([
    [{ name: "" }, "Informe seu nome."],
    [{ name: 42 }, "Informe seu nome."],
    [{ name: "x".repeat(81) }, "O nome pode ter no máximo 80 caracteres."],
    [{ displayName: 1 }, "Nome de exibição inválido."],
    [{ displayName: "x".repeat(41) }, "O nome de exibição pode ter no máximo 40 caracteres."],
    [{ hasCompletedOnboarding: "sim" }, "Valor inválido para hasCompletedOnboarding."],
  ])("PATCH valida o corpo (caso %#)", async (body, message) => {
    const { token } = await signup();
    const res = await api("PATCH", "/me", { token, body });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe(message);
  });
});
