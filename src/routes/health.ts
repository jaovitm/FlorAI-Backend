import { Hono } from "hono";
import type { AppEnv } from "../types/env";

const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error("D1 health check failed", err);
    return c.json({ status: "error", database: "unreachable" }, 503);
  }
});

export default health;
