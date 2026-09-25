import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { AppEnv } from "./types/env";
import { ApiError } from "./lib/errors";
import { requireAuth } from "./middleware/auth";
import health from "./routes/health";
import auth from "./routes/auth";
import me from "./routes/me";
import identifications from "./routes/identifications";
import collections from "./routes/collections";
import plants from "./routes/plants";
import { subscription, usage } from "./routes/subscription";
import reminders from "./routes/reminders";
import images from "./routes/images";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept", "X-Timezone-Offset"],
    maxAge: 86400,
  }),
);

app.get("/", (c) => c.json({ name: "FlorAI API", status: "running" }));

app.route("/health", health);
app.route("/images", images);
app.route("/auth", auth);

for (const path of ["/me", "/identifications", "/collections", "/plants", "/subscription", "/usage", "/reminders"]) {
  app.use(path, requireAuth);
  app.use(`${path}/*`, requireAuth);
}
app.route("/me", me);
app.route("/identifications", identifications);
app.route("/collections", collections);
app.route("/plants", plants);
app.route("/subscription", subscription);
app.route("/usage", usage);
app.route("/reminders", reminders);

app.notFound((c) => c.json({ error: { code: "not_found", message: "Rota não encontrada." } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(err.toJSON(), err.status);
  if (err instanceof HTTPException && err.status < 500) {
    return c.json({ error: { code: "validation_error", message: "Requisição inválida." } }, err.status);
  }
  console.error(err);
  return c.json(
    { error: { code: "internal_error", message: "Algo deu errado. Tente novamente em instantes." } },
    500,
  );
});

export default app;
