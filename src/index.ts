import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppEnv } from "./types/env";
import health from "./routes/health";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("*", cors());

app.get("/", (c) => c.json({ name: "FlorAI API", status: "running" }));

app.route("/health", health);

app.notFound((c) => c.json({ error: "Not Found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
