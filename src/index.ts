import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { AppEnv, Bindings } from "./types/env";
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
import webhooks from "./routes/webhooks";
import referrals from "./routes/referrals";
import affiliates from "./routes/affiliates";
import admin from "./routes/admin";
import devices from "./routes/devices";
import { sendWateringPushes } from "./jobs/watering-push";

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
// Fora do requireAuth: o Pub/Sub não manda Bearer (autentica por `?secret=`).
app.route("/webhooks", webhooks);
// Programa de afiliados: link curto (/a/:code), instalações, painel do parceiro (/p/:token) e admin.
app.route("/", affiliates);
app.route("/admin", admin);

for (const path of ["/me", "/identifications", "/collections", "/plants", "/subscription", "/usage", "/reminders", "/referrals", "/devices"]) {
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
app.route("/referrals", referrals);
app.route("/devices", devices);

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

export { app };

export default {
  fetch: app.fetch,
  // Cron (wrangler.jsonc > triggers): pushes de rega.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sendWateringPushes(env));
  },
} satisfies ExportedHandler<Bindings>;
