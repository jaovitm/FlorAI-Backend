import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { notFound, validationError } from "../lib/errors";
import { readJson } from "../lib/http";
import { notifyUser } from "../lib/push";

const devices = new Hono<AppEnv>();

// Salva o token FCM e o sistema (android/ios) do aparelho no usuário. Idempotente: o app chama a cada login.
devices.post("/", async (c) => {
  const user = c.get("user");
  const body = await readJson(c);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 4096) throw validationError("Token do aparelho inválido.");
  // O app Flutter envia `TargetPlatform.name` ("android", "iOS").
  const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
  if (platform !== "android" && platform !== "ios") throw validationError("Plataforma deve ser android ou ios.");

  await c.env.DB.batch([
    // O aparelho pode ter sido de outra conta (troca de usuário no mesmo celular).
    c.env.DB.prepare("UPDATE users SET push_token = NULL, push_platform = NULL WHERE push_token = ? AND id != ?")
      .bind(token, user.id),
    c.env.DB.prepare("UPDATE users SET push_token = ?, push_platform = ? WHERE id = ?").bind(token, platform, user.id),
  ]);
  return c.body(null, 204);
});

// Manda um push de teste para o aparelho do próprio usuário.
devices.post("/test", async (c) => {
  const user = c.get("user");
  const result = await notifyUser(c.env, user, {
    title: "Teste do FlorAI 🌱",
    body: "Se você está vendo isto, o push está funcionando.",
  });
  if (!result) throw notFound("Nenhum aparelho cadastrado para receber push.");
  if (!result.ok) return c.json({ sent: false, invalidToken: result.invalidToken, error: result.error }, 502);
  return c.json({ sent: true });
});

export default devices;
