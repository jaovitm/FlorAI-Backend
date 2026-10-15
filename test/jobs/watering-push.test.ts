import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../../src/lib/crypto";
import { sendWateringPushes } from "../../src/jobs/watering-push";
import { api, createPlant, env, setPlan, signup } from "../helpers";

const brt = (iso: string) => Date.parse(`${iso}-03:00`);

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
    client_email: "push-watering@florai-test.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${bytesToBase64(pkcs8)}\n-----END PRIVATE KEY-----\n`,
    token_uri: "https://oauth2.googleapis.com/token",
  });
});

afterEach(() => {
  env.FIREBASE_SERVICE_ACCOUNT = "";
});

/** Mocka Google + FCM e devolve as mensagens enviadas ao FCM. */
function mockFcm(send: () => Response = () => Response.json({ name: "projects/florai-test/messages/1" })) {
  const sent: any[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    if (url.startsWith("https://fcm.googleapis.com/")) {
      sent.push(JSON.parse(init!.body as string).message);
      return send();
    }
    throw new Error(`Rede bloqueada nos testes: ${url}`);
  });
  return sent;
}

/**
 * Usuário (Brasília) com plano, token de push e uma planta com lembrete:
 * última rega em 01/05, a cada 3 dias às 09:30 → previsto para 04/05.
 */
async function userWithReminder({ plan = "basic" as const, pushToken = "fcm-device" } = {}) {
  const u = await signup();
  if (plan !== "free") await setPlan(u.token, plan);
  await env.DB.prepare("UPDATE users SET tz_offset = -180 WHERE id = ?").bind(u.user.id).run();
  await api("POST", "/devices", { token: u.token, body: { token: pushToken, platform: "android" } });
  const { plantId } = await createPlant(u.token, u.user.id);
  const reminderId = `rem_${crypto.randomUUID()}`;
  if (plan === "free") {
    await env.DB.prepare(
      `INSERT INTO reminders (id, user_id, plant_id, interval_days, hour, minute, last_watered_at, created_at)
       VALUES (?, ?, ?, 3, 9, 30, '2026-05-02T01:00:00.000Z', '2026-04-01T00:00:00.000Z')`,
    )
      .bind(reminderId, u.user.id, plantId)
      .run();
  } else {
    const res = await api("PUT", `/reminders/${reminderId}`, {
      token: u.token,
      body: { plantId, intervalDays: 3, hour: 9, minute: 30, lastWateredAt: "2026-05-01T22:00:00-03:00" },
    });
    expect(res.status).toBe(200);
  }
  return { ...u, plantId, reminderId, pushToken };
}

/** Só os pushes deste usuário (o D1 é compartilhado entre os testes do arquivo). */
const forToken = (sent: any[], token: string) => sent.filter((m) => m.token === token);

describe("sendWateringPushes", () => {
  it("sem service account não envia nada", async () => {
    const sent = mockFcm();
    await userWithReminder({ pushToken: "fcm-no-config" });
    expect(await sendWateringPushes(env, brt("2026-05-04T09:31:00"))).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("envia o lembrete no horário escolhido, só dados, uma única vez", async () => {
    env.FIREBASE_SERVICE_ACCOUNT = serviceAccount;
    const sent = mockFcm();
    const { reminderId, plantId, pushToken } = await userWithReminder({ pushToken: "fcm-scheduled" });

    await sendWateringPushes(env, brt("2026-05-04T09:29:00"));
    expect(forToken(sent, pushToken)).toHaveLength(0);

    await sendWateringPushes(env, brt("2026-05-04T09:31:00"));
    await sendWateringPushes(env, brt("2026-05-04T09:32:00"));
    const mine = forToken(sent, pushToken);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({
      token: pushToken,
      android: { priority: "high" },
      data: {
        type: "watering",
        category: "scheduled",
        reminderId,
        plantId,
        plantName: "Jiboia",
        title: "Hora de regar 💧",
        body: "Jiboia está esperando por água.",
      },
    });
    expect(mine[0].notification).toBeUndefined();
  });

  it("aviso diário de manhã e à noite enquanto não regar", async () => {
    env.FIREBASE_SERVICE_ACCOUNT = serviceAccount;
    const sent = mockFcm();
    const { pushToken, reminderId } = await userWithReminder({ pushToken: "fcm-daily" });

    // 03/05 ainda não é dia de rega.
    await sendWateringPushes(env, brt("2026-05-03T08:00:00"));
    expect(forToken(sent, pushToken)).toHaveLength(0);

    await sendWateringPushes(env, brt("2026-05-04T08:00:00"));
    await sendWateringPushes(env, brt("2026-05-04T08:01:00"));
    await sendWateringPushes(env, brt("2026-05-04T18:00:00"));
    expect(forToken(sent, pushToken).map((m) => [m.data.category, m.data.title])).toEqual([
      ["daily", "Jiboia precisa de água hoje 🌱"],
      ["daily", "Não esqueça de regar: Jiboia 💧"],
    ]);

    // Regou: no dia seguinte não há aviso diário.
    await env.DB.prepare("UPDATE reminders SET last_watered_at = ? WHERE id = ?")
      .bind(new Date(brt("2026-05-04T19:00:00")).toISOString(), reminderId)
      .run();
    await sendWateringPushes(env, brt("2026-05-05T08:00:00"));
    expect(forToken(sent, pushToken)).toHaveLength(2);
  });

  it("plano gratuito não recebe", async () => {
    env.FIREBASE_SERVICE_ACCOUNT = serviceAccount;
    const sent = mockFcm();
    const { pushToken } = await userWithReminder({ plan: "free", pushToken: "fcm-free" });
    await sendWateringPushes(env, brt("2026-05-04T09:31:00"));
    expect(forToken(sent, pushToken)).toHaveLength(0);
  });

  it("token recusado pelo FCM é apagado e o envio não é marcado", async () => {
    env.FIREBASE_SERVICE_ACCOUNT = serviceAccount;
    mockFcm(() =>
      Response.json({ error: { code: 404, status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 }),
    );
    const { user, reminderId } = await userWithReminder({ pushToken: "fcm-dead-watering" });
    await sendWateringPushes(env, brt("2026-05-04T09:31:00"));

    const userRow = await env.DB.prepare("SELECT push_token FROM users WHERE id = ?").bind(user.id).first();
    const reminder = await env.DB.prepare("SELECT scheduled_push_key FROM reminders WHERE id = ?").bind(reminderId).first();
    expect(userRow).toEqual({ push_token: null });
    expect(reminder).toEqual({ scheduled_push_key: null });
  });
});

describe("POST /reminders/:id/watered", () => {
  it("registra a rega agora", async () => {
    const { token, reminderId } = await userWithReminder({ pushToken: "fcm-watered" });
    const before = Date.now();
    const res = await api("POST", `/reminders/${reminderId}/watered`, { token });
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(reminderId);
    expect(Date.parse(res.json.lastWateredAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("404 para lembrete de outro usuário", async () => {
    const { reminderId } = await userWithReminder({ pushToken: "fcm-owner" });
    const other = await signup();
    await setPlan(other.token, "basic");
    const res = await api("POST", `/reminders/${reminderId}/watered`, { token: other.token });
    expect(res.status).toBe(404);
  });

  it("403 no plano gratuito", async () => {
    const { token, reminderId } = await userWithReminder({ plan: "free", pushToken: "fcm-free-watered" });
    const res = await api("POST", `/reminders/${reminderId}/watered`, { token });
    expect(res.status).toBe(403);
    expect(res.json.error).toMatchObject({ code: "plan_limit", feature: "wateringAlerts" });
  });
});
