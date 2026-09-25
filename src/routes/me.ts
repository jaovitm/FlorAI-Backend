import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { validationError } from "../lib/errors";
import { readJson } from "../lib/http";
import { userJson } from "../lib/serialize";

const me = new Hono<AppEnv>();

me.get("/", (c) => c.json(userJson(c.get("user"))));

me.patch("/", async (c) => {
  const body = await readJson(c);
  const user = { ...c.get("user") };

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw validationError("Informe seu nome.");
    if (name.length > 80) throw validationError("O nome pode ter no máximo 80 caracteres.");
    user.name = name;
  }

  if ("displayName" in body) {
    if (body.displayName !== null && typeof body.displayName !== "string") {
      throw validationError("Nome de exibição inválido.");
    }
    const displayName = body.displayName?.trim() || null;
    if (displayName && displayName.length > 40) {
      throw validationError("O nome de exibição pode ter no máximo 40 caracteres.");
    }
    user.display_name = displayName;
  }

  if ("hasCompletedOnboarding" in body) {
    if (typeof body.hasCompletedOnboarding !== "boolean") {
      throw validationError("Valor inválido para hasCompletedOnboarding.");
    }
    user.has_completed_onboarding = body.hasCompletedOnboarding ? 1 : 0;
  }

  await c.env.DB.prepare(
    "UPDATE users SET name = ?, display_name = ?, has_completed_onboarding = ? WHERE id = ?",
  )
    .bind(user.name, user.display_name, user.has_completed_onboarding, user.id)
    .run();

  return c.json(userJson(user));
});

export default me;
