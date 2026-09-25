import { Hono } from "hono";
import type { AppEnv } from "../types/env";

const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  const [database, storage] = await Promise.all([
    c.env.DB.prepare("SELECT 1")
      .first()
      .then(() => "connected")
      .catch((err) => {
        console.error("D1 health check failed", err);
        return "unreachable";
      }),
    c.env.BUCKET.list({ limit: 1 })
      .then(() => "connected")
      .catch((err) => {
        console.error("R2 health check failed", err);
        return "unreachable";
      }),
  ]);

  const ok = database === "connected" && storage === "connected";
  return c.json({ status: ok ? "ok" : "error", database, storage }, ok ? 200 : 503);
});

export default health;
