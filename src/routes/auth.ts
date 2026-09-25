import { Hono } from "hono";
import type { AppEnv, UserRow } from "../types/env";
import { hashPassword, newId, newToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { ApiError, validationError } from "../lib/errors";
import { addDays, nowIso, parseTzOffset, readJson } from "../lib/http";
import { userJson } from "../lib/serialize";
import { requireAuth } from "../middleware/auth";

const SESSION_DAYS = 90;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const auth = new Hono<AppEnv>();

async function createSession(db: D1Database, userId: string) {
  const token = newToken();
  const now = new Date();
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now.toISOString(), addDays(now, SESSION_DAYS).toISOString())
    .run();
  return token;
}

auth.post("/signup", async (c) => {
  const body = await readJson(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name) throw validationError("Informe seu nome.");
  if (name.length > 80) throw validationError("O nome pode ter no máximo 80 caracteres.");
  if (!EMAIL_RE.test(email) || email.length > 254) throw validationError("Informe um e-mail válido.");
  if (password.length < 6) throw validationError("A senha precisa ter pelo menos 6 caracteres.");

  const emailTaken = () =>
    new ApiError(409, "email_taken", "Já existe uma conta com este e-mail. Tente entrar.");

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) throw emailTaken();

  const pw = await hashPassword(password);
  const now = nowIso();
  const user: UserRow = {
    id: newId("usr"),
    name,
    email,
    display_name: null,
    has_completed_onboarding: 0,
    password_hash: pw.hash,
    password_salt: pw.salt,
    password_iterations: pw.iterations,
    tz_offset: parseTzOffset(c.req.header("X-Timezone-Offset")) ?? 0,
    created_at: now,
  };

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, name, email, display_name, has_completed_onboarding,
           password_hash, password_salt, password_iterations, tz_offset, created_at)
         VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)`,
      ).bind(user.id, name, email, pw.hash, pw.salt, pw.iterations, user.tz_offset, now),
      c.env.DB.prepare(
        "INSERT INTO subscriptions (user_id, plan, started_at, renews_at) VALUES (?, 'free', ?, NULL)",
      ).bind(user.id, now),
    ]);
  } catch (err) {
    // Cadastro simultâneo com o mesmo e-mail.
    if (String(err).includes("UNIQUE")) throw emailTaken();
    throw err;
  }

  const token = await createSession(c.env.DB, user.id);
  return c.json({ token, user: userJson(user) }, 201);
});

auth.post("/login", async (c) => {
  const body = await readJson(c);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const user = email
    ? await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>()
    : null;
  const ok =
    user !== null &&
    (await verifyPassword(password, {
      hash: user.password_hash,
      salt: user.password_salt,
      iterations: user.password_iterations,
    }));
  if (!user || !ok) {
    throw new ApiError(401, "invalid_credentials", "E-mail ou senha incorretos.");
  }

  const token = await createSession(c.env.DB, user.id);
  return c.json({ token, user: userJson(user) });
});

auth.post("/logout", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(c.get("tokenHash")).run();
  return c.body(null, 204);
});

export default auth;
