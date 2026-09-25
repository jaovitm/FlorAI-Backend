import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { validationError } from "../lib/errors";
import { addDays, localDay, readJson } from "../lib/http";
import { isPlan } from "../lib/plans";
import { subscriptionJson, type SubscriptionRow } from "../lib/serialize";

export const subscription = new Hono<AppEnv>();

subscription.get("/", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .bind(user.id)
    .first<SubscriptionRow>();
  // Usuários sem linha (não deveria acontecer) são tratados como free desde o cadastro.
  return c.json(
    subscriptionJson(row ?? { user_id: user.id, plan: "free", started_at: user.created_at, renews_at: null }),
  );
});

// Modo de teste: troca o plano na hora, sem cobrança.
subscription.post("/", async (c) => {
  const body = await readJson(c);
  if (!isPlan(body.plan)) throw validationError("Plano inválido.");

  const now = new Date();
  const renewsAt = body.plan === "free" ? null : addDays(now, 30).toISOString();
  const row = await c.env.DB.prepare(
    `INSERT INTO subscriptions (user_id, plan, started_at, renews_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, started_at = excluded.started_at,
       renews_at = excluded.renews_at
     RETURNING *`,
  )
    .bind(c.get("user").id, body.plan, now.toISOString(), renewsAt)
    .first<SubscriptionRow>();
  return c.json(subscriptionJson(row!));
});

export const usage = new Hono<AppEnv>();

usage.get("/today", async (c) => {
  const day = localDay(c.get("tzOffset"));
  const identifications = await c.env.DB.prepare(
    "SELECT identifications FROM daily_usage WHERE user_id = ? AND day = ?",
  )
    .bind(c.get("user").id, day)
    .first<number>("identifications");
  return c.json({ day, identifications: identifications ?? 0 });
});
