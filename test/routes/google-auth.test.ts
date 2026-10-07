import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toBase64Url } from "../../src/lib/crypto";
import { resetGoogleKeysCache, verifyGoogleIdToken } from "../../src/lib/google";
import { api, env, signup, uniqueEmail } from "../helpers";

const CLIENT_ID = env.GOOGLE_CLIENT_ID;
const KID = "test-kid";

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
});

/** Mocka as chaves públicas do Google e conta quantas vezes foram buscadas. */
function mockGoogleCerts() {
  const calls = { count: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      calls.count++;
      return Response.json(
        { keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] },
        { headers: { "cache-control": "public, max-age=3600" } },
      );
    }
    throw new Error(`Rede bloqueada nos testes: ${url}`);
  });
  return calls;
}

const json64 = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

/** ID token como o Google emite, assinado com a chave de teste. */
async function idToken(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${json64({ alg: "RS256", kid: KID, typ: "JWT", ...header })}.${json64({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: `google-${crypto.randomUUID()}`,
    email: uniqueEmail(),
    email_verified: true,
    name: "Maria Silva",
    iat: now,
    exp: now + 3600,
    ...claims,
  })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

beforeEach(() => {
  resetGoogleKeysCache();
});

describe("verifyGoogleIdToken", () => {
  it("aceita token válido e normaliza o e-mail", async () => {
    mockGoogleCerts();
    const identity = await verifyGoogleIdToken(await idToken({ sub: "123", email: "Maria@Gmail.com" }), CLIENT_ID);
    expect(identity).toEqual({ sub: "123", email: "maria@gmail.com", name: "Maria Silva" });
  });

  it.each([
    ["outro público", { aud: "outro-app.apps.googleusercontent.com" }],
    ["outro emissor", { iss: "https://evil.example.com" }],
    ["expirado", { exp: Math.floor(Date.now() / 1000) - 600 }],
    ["e-mail não verificado", { email_verified: false }],
    ["sem e-mail", { email: undefined }],
  ])("recusa token com %s", async (_, claims) => {
    mockGoogleCerts();
    expect(await verifyGoogleIdToken(await idToken(claims), CLIENT_ID)).toBeNull();
  });

  it("recusa assinatura adulterada, kid desconhecido e lixo", async () => {
    mockGoogleCerts();
    const [h, , s] = (await idToken()).split(".");
    const forged = `${h}.${json64({ iss: "accounts.google.com", aud: CLIENT_ID, sub: "x", email: "a@b.c", email_verified: true, exp: 9e9 })}.${s}`;
    expect(await verifyGoogleIdToken(forged, CLIENT_ID)).toBeNull();
    expect(await verifyGoogleIdToken(await idToken({}, { kid: "desconhecido" }), CLIENT_ID)).toBeNull();
    expect(await verifyGoogleIdToken("nao.e.jwt", CLIENT_ID)).toBeNull();
    expect(await verifyGoogleIdToken(await idToken({}, { alg: "none" }), CLIENT_ID)).toBeNull();
  });

  it("guarda as chaves em cache", async () => {
    const calls = mockGoogleCerts();
    await verifyGoogleIdToken(await idToken(), CLIENT_ID);
    await verifyGoogleIdToken(await idToken(), CLIENT_ID);
    expect(calls.count).toBe(1);
  });
});

describe("POST /auth/google", () => {
  it("cria conta sem senha no plano gratuito", async () => {
    mockGoogleCerts();
    const email = uniqueEmail();
    const res = await api("POST", "/auth/google", { body: { idToken: await idToken({ email }) } });
    expect(res.status).toBe(201);
    expect(res.json.user).toMatchObject({ name: "Maria Silva", email, hasCompletedOnboarding: false });

    const me = await api("GET", "/me", { token: res.json.token });
    expect(me.status).toBe(200);
    const sub = await api("GET", "/subscription", { token: res.json.token });
    expect(sub.json.plan).toBe("free");

    // Conta só do Google não entra por senha (nem com senha vazia).
    const login = await api("POST", "/auth/login", { body: { email, password: "" } });
    expect(login.status).toBe(401);
  });

  it("entra de novo na mesma conta pelo sub", async () => {
    mockGoogleCerts();
    const sub = `google-${crypto.randomUUID()}`;
    const first = await api("POST", "/auth/google", { body: { idToken: await idToken({ sub }) } });
    // O e-mail da conta Google pode mudar; o sub não.
    const again = await api("POST", "/auth/google", { body: { idToken: await idToken({ sub }) } });
    expect(again.status).toBe(200);
    expect(again.json.user.id).toBe(first.json.user.id);
  });

  it("vincula conta existente com o mesmo e-mail e mantém a senha", async () => {
    mockGoogleCerts();
    const existing = await signup({ password: "segredo123" });
    const res = await api("POST", "/auth/google", { body: { idToken: await idToken({ email: existing.user.email }) } });
    expect(res.status).toBe(200);
    expect(res.json.user.id).toBe(existing.user.id);

    const login = await api("POST", "/auth/login", { body: { email: existing.user.email, password: "segredo123" } });
    expect(login.status).toBe(200);
  });

  it("409 quando o e-mail já está vinculado a outra conta Google", async () => {
    mockGoogleCerts();
    const email = uniqueEmail();
    await api("POST", "/auth/google", { body: { idToken: await idToken({ email }) } });
    const res = await api("POST", "/auth/google", { body: { idToken: await idToken({ email }) } });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("google_account_conflict");
  });

  it("401 com token inválido e 400 sem token", async () => {
    mockGoogleCerts();
    const bad = await api("POST", "/auth/google", { body: { idToken: await idToken({ aud: "outro" }) } });
    expect(bad.status).toBe(401);
    expect(bad.json.error.code).toBe("invalid_google_token");
    const missing = await api("POST", "/auth/google", { body: {} });
    expect(missing.status).toBe(400);
  });
});
