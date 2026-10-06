import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../../src/lib/crypto";
import { api, env, signup } from "../helpers";

const pushToken = (userId: string) =>
  env.DB.prepare("SELECT push_token FROM users WHERE id = ?").bind(userId).first<string | null>("push_token");

const pushDevice = (userId: string) =>
  env.DB.prepare("SELECT push_token, push_platform FROM users WHERE id = ?")
    .bind(userId)
    .first<{ push_token: string | null; push_platform: string | null }>();

let serviceAccount: string;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  serviceAccount = JSON.stringify({
    project_id: "florai-test",
    client_email: "push-devices@florai-test.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)}\n-----END PRIVATE KEY-----\n`,
    token_uri: "https://oauth2.googleapis.com/token",
  });
});

afterEach(() => {
  env.FIREBASE_SERVICE_ACCOUNT = "";
});

/** Google responde o access token; o FCM responde com [send]. */
function mockFcm(send: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (url.startsWith("https://fcm.googleapis.com/")) return send();
    throw new Error(`Rede bloqueada nos testes: ${url}`);
  });
}

describe("POST /devices", () => {
  it("exige sessão", async () => {
    const res = await api("POST", "/devices", { body: { token: "abc", platform: "android" } });
    expect(res.status).toBe(401);
  });

  it("salva o token no usuário e é idempotente", async () => {
    const { token, user } = await signup();
    expect((await api("POST", "/devices", { token, body: { token: "fcm-1", platform: "android" } })).status).toBe(204);
    expect((await api("POST", "/devices", { token, body: { token: "fcm-1", platform: "android" } })).status).toBe(204);
    expect(await pushToken(user.id)).toBe("fcm-1");
  });

  it("troca o token quando o aparelho muda", async () => {
    const { token, user } = await signup();
    await api("POST", "/devices", { token, body: { token: "fcm-old", platform: "android" } });
    await api("POST", "/devices", { token, body: { token: "fcm-new", platform: "android" } });
    expect(await pushToken(user.id)).toBe("fcm-new");
  });

  it("move o token para a conta nova quando outro usuário entra no mesmo celular", async () => {
    const a = await signup();
    const b = await signup();
    await api("POST", "/devices", { token: a.token, body: { token: "shared-device", platform: "android" } });
    await api("POST", "/devices", { token: b.token, body: { token: "shared-device", platform: "android" } });
    expect(await pushDevice(a.user.id)).toEqual({ push_token: null, push_platform: null });
    expect(await pushToken(b.user.id)).toBe("shared-device");
  });

  it("salva o sistema do aparelho e aceita o nome do Flutter (iOS)", async () => {
    const { token, user } = await signup();
    await api("POST", "/devices", { token, body: { token: "fcm-iphone", platform: "iOS" } });
    expect(await pushDevice(user.id)).toEqual({ push_token: "fcm-iphone", push_platform: "ios" });
  });

  it("recusa plataforma ausente ou desconhecida", async () => {
    const { token } = await signup();
    for (const platform of [undefined, "windows"]) {
      const res = await api("POST", "/devices", { token, body: { token: "fcm-1", platform } });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe("validation_error");
    }
  });

  it("recusa token vazio", async () => {
    const { token } = await signup();
    const res = await api("POST", "/devices", { token, body: { token: "  ", platform: "android" } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("validation_error");
  });

  it("não expõe o token em /me", async () => {
    const { token } = await signup();
    await api("POST", "/devices", { token, body: { token: "fcm-secret", platform: "android" } });
    const me = await api("GET", "/me", { token });
    expect(JSON.stringify(me.json)).not.toContain("fcm-secret");
  });

  it("logout apaga o token", async () => {
    const { token, user } = await signup();
    await api("POST", "/devices", { token, body: { token: "fcm-1", platform: "android" } });
    await api("POST", "/auth/logout", { token });
    expect(await pushDevice(user.id)).toEqual({ push_token: null, push_platform: null });
  });
});

describe("POST /devices/test", () => {
  it("404 sem aparelho cadastrado", async () => {
    const { token } = await signup();
    const res = await api("POST", "/devices/test", { token });
    expect(res.status).toBe(404);
  });

  it("envia o push para o token salvo", async () => {
    env.FIREBASE_SERVICE_ACCOUNT = serviceAccount;
    const fetchSpy = mockFcm(() => Response.json({ name: "projects/florai-test/messages/1" }));
    const { token } = await signup();
    await api("POST", "/devices", { token, body: { token: "fcm-ok", platform: "android" } });

    const res = await api("POST", "/devices/test", { token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ sent: true });
    const send = fetchSpy.mock.calls.find(([input]) => String(input).startsWith("https://fcm.googleapis.com/"));
    expect(JSON.parse((send![1] as RequestInit).body as string).message.token).toBe("fcm-ok");
  });

  it("apaga o token quando o FCM diz que ele não existe mais", async () => {
    env.FIREBASE_SERVICE_ACCOUNT = serviceAccount;
    mockFcm(() =>
      Response.json({ error: { code: 404, status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 }),
    );
    const { token, user } = await signup();
    await api("POST", "/devices", { token, body: { token: "fcm-dead", platform: "android" } });

    const res = await api("POST", "/devices/test", { token });
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ sent: false, invalidToken: true });
    expect(await pushToken(user.id)).toBeNull();
  });

  it("500 quando o servidor não tem a service account", async () => {
    const { token } = await signup();
    await api("POST", "/devices", { token, body: { token: "fcm-1", platform: "android" } });
    const res = await api("POST", "/devices/test", { token });
    expect(res.status).toBe(500);
  });
});
