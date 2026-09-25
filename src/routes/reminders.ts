import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { notFound, planLimit, validationError } from "../lib/errors";
import { normalizeIso, nowIso, readJson } from "../lib/http";
import { getPlan, PLAN_LIMITS } from "../lib/plans";
import { reminderJson, type ReminderRow } from "../lib/serialize";

const reminders = new Hono<AppEnv>();

function intInRange(value: unknown, min: number, max: number, message: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw validationError(message);
  }
  return value;
}

reminders.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM reminders WHERE user_id = ? ORDER BY created_at ASC, id ASC",
  )
    .bind(c.get("user").id)
    .all<ReminderRow>();
  return c.json({ items: results.map(reminderJson) });
});

// Upsert: o id é gerado pelo app.
reminders.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id").trim();
  if (!id || id.length > 100) throw validationError("Identificador do lembrete inválido.");

  const body = await readJson(c);
  const plantId = typeof body.plantId === "string" ? body.plantId : "";
  const intervalDays = intInRange(body.intervalDays, 1, 60, "O intervalo deve ser de 1 a 60 dias.");
  const hour = intInRange(body.hour, 0, 23, "Horário inválido.");
  const minute = intInRange(body.minute, 0, 59, "Horário inválido.");
  let lastWateredAt: string | null = null;
  if (body.lastWateredAt != null) {
    lastWateredAt = normalizeIso(body.lastWateredAt);
    if (!lastWateredAt) throw validationError("Data da última rega inválida.");
  }

  const plan = await getPlan(c.env.DB, user.id);
  if (!PLAN_LIMITS[plan].wateringAlerts) {
    throw planLimit("wateringAlerts", plan, "Lembretes de rega não estão disponíveis no plano gratuito.");
  }

  const [plant, existing] = await Promise.all([
    c.env.DB.prepare("SELECT 1 FROM plants WHERE id = ? AND user_id = ?").bind(plantId, user.id).first(),
    c.env.DB.prepare("SELECT user_id, created_at FROM reminders WHERE id = ?")
      .bind(id)
      .first<{ user_id: string; created_at: string }>(),
  ]);
  if (!plant) throw notFound("Planta não encontrada.");
  // Id já usado por outro usuário: não revela que existe.
  if (existing && existing.user_id !== user.id) throw notFound("Lembrete não encontrado.");

  const createdAt = existing?.created_at ?? normalizeIso(body.createdAt) ?? nowIso();

  // Um lembrete por planta: remove outro lembrete da mesma planta antes do upsert.
  const [, row] = await c.env.DB.batch<ReminderRow>([
    c.env.DB.prepare("DELETE FROM reminders WHERE plant_id = ? AND user_id = ? AND id <> ?").bind(
      plantId,
      user.id,
      id,
    ),
    c.env.DB.prepare(
      `INSERT INTO reminders (id, user_id, plant_id, interval_days, hour, minute, last_watered_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET plant_id = excluded.plant_id, interval_days = excluded.interval_days,
         hour = excluded.hour, minute = excluded.minute, last_watered_at = excluded.last_watered_at
       RETURNING *`,
    ).bind(id, user.id, plantId, intervalDays, hour, minute, lastWateredAt, createdAt),
  ]);
  return c.json(reminderJson(row.results[0]));
});

reminders.delete("/:id", async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .run();
  if (!result.meta.changes) throw notFound("Lembrete não encontrado.");
  return c.body(null, 204);
});

export default reminders;
