import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/crypto";
import { api, env, signup, uniqueEmail } from "../helpers";

describe("POST /auth/signup", () => {
  it("cria usuário, assinatura free e sessão", async () => {
    const email = uniqueEmail();
    const res = await api("POST", "/auth/signup", {
      body: { name: "  Ana  ", email: `  ${email.toUpperCase()} `, password: "secret123" },
      headers: { "X-Timezone-Offset": "-180" },
    });
    expect(res.status).toBe(201);
    expect(res.json.token).toEqual(expect.any(String));
    expect(res.json.user).toMatchObject({ name: "Ana", email, displayName: null, hasCompletedOnboarding: false });
    expect(res.json.user.id).toMatch(/^usr_/);

    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(res.json.user.id).first<any>();
    expect(row.tz_offset).toBe(-180);
    expect(row.password_hash).not.toBe("secret123");
    const sub = await env.DB.prepare("SELECT plan FROM subscriptions WHERE user_id = ?").bind(row.id).first<any>();
    expect(sub.plan).toBe("free");
    // O token não é salvo em claro.
    const session = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(res.json.token))
      .first<any>();
    expect(session.user_id).toBe(row.id);
    const days = (Date.parse(session.expires_at) - Date.parse(session.created_at)) / 86_400_000;
    expect(days).toBe(90);
  });

  it.each([
    [{ email: "a@b.co", password: "secret123" }, "Informe seu nome."],
    [{ name: "x".repeat(81), email: "a@b.co", password: "secret123" }, "O nome pode ter no máximo 80 caracteres."],
    [{ name: "Ana", email: "invalido", password: "secret123" }, "Informe um e-mail válido."],
    [{ name: "Ana", email: `${"a".repeat(250)}@b.co`, password: "secret123" }, "Informe um e-mail válido."],
    [{ name: "Ana", email: "a@b.co", password: "12345" }, "A senha precisa ter pelo menos 6 caracteres."],
  ])("valida o corpo (caso %#)", async (body, message) => {
    const res = await api("POST", "/auth/signup", { body });
    expect(res.status).toBe(400);
    expect(res.json.error).toEqual({ code: "validation_error", message });
  });

  it("rejeita corpo que não é objeto JSON", async () => {
    for (const body of ["não é json", "[1,2]", "null"]) {
      const res = await api("POST", "/auth/signup", { body });
      expect(res.status).toBe(400);
      expect(res.json.error.message).toBe("Corpo da requisição inválido.");
    }
  });

  it("rejeita e-mail já cadastrado (sem diferenciar maiúsculas)", async () => {
    const { email } = await signup();
    const res = await api("POST", "/auth/signup", {
      body: { name: "Outro", email: email.toUpperCase(), password: "secret123" },
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("email_taken");
  });
});

describe("POST /auth/login", () => {
  it("entra com e-mail e senha corretos", async () => {
    const { email, password, user } = await signup();
    const res = await api("POST", "/auth/login", { body: { email: ` ${email.toUpperCase()}`, password } });
    expect(res.status).toBe(200);
    expect(res.json.user.id).toBe(user.id);
    expect((await api("GET", "/me", { token: res.json.token })).status).toBe(200);
  });

  it.each([
    ["senha errada", (email: string) => ({ email, password: "errada1" })],
    ["e-mail desconhecido", () => ({ email: uniqueEmail(), password: "secret123" })],
    ["e-mail vazio", () => ({ password: "secret123" })],
  ])("retorna invalid_credentials com %s", async (_, makeBody) => {
    const { email } = await signup();
    const res = await api("POST", "/auth/login", { body: makeBody(email) });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("invalid_credentials");
  });
});

describe("POST /auth/logout", () => {
  it("invalida apenas a sessão atual", async () => {
    const { token, email, password } = await signup();
    const other = (await api("POST", "/auth/login", { body: { email, password } })).json.token;

    const res = await api("POST", "/auth/logout", { token });
    expect(res.status).toBe(204);
    expect((await api("GET", "/me", { token })).status).toBe(401);
    expect((await api("GET", "/me", { token: other })).status).toBe(200);
  });

  it("exige autenticação", async () => {
    expect((await api("POST", "/auth/logout")).status).toBe(401);
  });
});

describe("middleware requireAuth", () => {
  it("rejeita header malformado e token desconhecido", async () => {
    expect((await api("GET", "/me", { headers: { Authorization: "Token abc" } })).status).toBe(401);
    expect((await api("GET", "/me", { token: "token-invalido" })).status).toBe(401);
  });

  it("aceita o esquema Bearer sem diferenciar maiúsculas", async () => {
    const { token } = await signup();
    expect((await api("GET", "/me", { headers: { Authorization: `bearer ${token}` } })).status).toBe(200);
  });

  it("rejeita sessão expirada", async () => {
    const { token } = await signup();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(token))
      .run();
    const res = await api("GET", "/me", { token });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe("Sua sessão expirou. Entre novamente.");
  });

  it("salva o fuso de X-Timezone-Offset e ignora valores inválidos", async () => {
    const { token, user } = await signup();
    const tz = () =>
      env.DB.prepare("SELECT tz_offset FROM users WHERE id = ?").bind(user.id).first<number>("tz_offset");

    await api("GET", "/me", { token, headers: { "X-Timezone-Offset": "120" } });
    expect(await tz()).toBe(120);
    await api("GET", "/me", { token, headers: { "X-Timezone-Offset": "9999" } });
    expect(await tz()).toBe(120);
  });
});
