import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../../src/lib/crypto";
import { parseServiceAccount, sendPush, type ServiceAccount } from "../../src/lib/fcm";

// Google e FCM são mockados no `fetch`; a chave RSA é gerada no teste.
let fetchSpy: ReturnType<typeof vi.spyOn>;
let publicKey: CryptoKey;
let account: ServiceAccount;
let accountCount = 0;

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://fcm.googleapis.com/v1/projects/florai-test/messages:send";

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  account = {
    project_id: "florai-test",
    client_email: "push@florai-test.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)}\n-----END PRIVATE KEY-----\n`,
    token_uri: TOKEN_URI,
  };
});

/** Conta com e-mail único: o cache de access token não vaza entre testes. */
const freshAccount = () => ({ ...account, client_email: `push${++accountCount}@florai-test.iam.gserviceaccount.com` });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function mockGoogle(send: () => Response = () => json({ name: "projects/florai-test/messages/1" })) {
  fetchSpy.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === TOKEN_URI) return json({ access_token: "ya29.test", expires_in: 3600 });
    if (url === SEND_URL) return send();
    throw new Error(`URL inesperada: ${url}`);
  });
}

const callsTo = (url: string) =>
  fetchSpy.mock.calls.filter(([input]) => (input instanceof Request ? input.url : String(input)) === url);

const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

describe("parseServiceAccount", () => {
  it("lê os campos usados do JSON da service account", () => {
    const parsed = parseServiceAccount(JSON.stringify({ type: "service_account", ...account }));
    expect(parsed.client_email).toBe(account.client_email);
  });

  it("recusa JSON sem a chave privada", () => {
    expect(() => parseServiceAccount(JSON.stringify({ project_id: "x" }))).toThrow();
  });
});

describe("sendPush", () => {
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  it("autentica com JWT RS256 assinado pela service account", async () => {
    mockGoogle();
    const acc = freshAccount();
    await sendPush(acc, "device-token", { title: "Oi", body: "Teste" });

    const [, init] = callsTo(TOKEN_URI)[0] as [string, RequestInit];
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const [header, claims, signature] = form.get("assertion")!.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(header)))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toMatchObject({
      iss: acc.client_email,
      aud: TOKEN_URI,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      fromBase64Url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("envia notification, data e o canal do Android", async () => {
    mockGoogle();
    const result = await sendPush(freshAccount(), "device-token", {
      title: "Hora de regar",
      body: "Sua jiboia está com sede.",
      data: { plantId: "plt_1" },
    });

    expect(result).toEqual({ ok: true });
    const [, init] = callsTo(SEND_URL)[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer ya29.test");
    expect(JSON.parse(init.body as string)).toEqual({
      message: {
        token: "device-token",
        notification: { title: "Hora de regar", body: "Sua jiboia está com sede." },
        data: { plantId: "plt_1" },
        android: { priority: "high", notification: { channel_id: "push" } },
      },
    });
  });

  it("reaproveita o access token entre envios", async () => {
    mockGoogle();
    const acc = freshAccount();
    await sendPush(acc, "a", { title: "1", body: "1" });
    await sendPush(acc, "b", { title: "2", body: "2" });

    expect(callsTo(TOKEN_URI)).toHaveLength(1);
    expect(callsTo(SEND_URL)).toHaveLength(2);
  });

  it("marca o token como inválido quando o FCM responde UNREGISTERED", async () => {
    mockGoogle(() =>
      json(
        {
          error: {
            code: 404,
            status: "NOT_FOUND",
            details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
          },
        },
        404,
      ),
    );
    const result = await sendPush(freshAccount(), "old-token", { title: "x", body: "y" });
    expect(result).toEqual({ ok: false, invalidToken: true, status: 404, error: "UNREGISTERED" });
  });

  it("mantém o token em erros temporários", async () => {
    mockGoogle(() => json({ error: { code: 503, status: "UNAVAILABLE" } }, 503));
    const result = await sendPush(freshAccount(), "device-token", { title: "x", body: "y" });
    expect(result).toEqual({ ok: false, invalidToken: false, status: 503, error: "UNAVAILABLE" });
  });
});
