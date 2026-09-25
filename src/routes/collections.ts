import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { newId } from "../lib/crypto";
import { notFound, planLimit, validationError } from "../lib/errors";
import { nowIso, readJson } from "../lib/http";
import { getPlan, PLAN_LIMITS } from "../lib/plans";
import { collectionJson, type CollectionRow } from "../lib/serialize";

const collections = new Hono<AppEnv>();

const COLLECTION_NOT_FOUND = "Coleção não encontrada.";

function parseName(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw validationError("Dê um nome para a coleção.");
  if (name.length > 30) throw validationError("O nome da coleção pode ter no máximo 30 caracteres.");
  return name;
}

collections.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM collections WHERE user_id = ? ORDER BY created_at ASC, id ASC",
  )
    .bind(c.get("user").id)
    .all<CollectionRow>();
  return c.json({ items: results.map(collectionJson) });
});

collections.post("/", async (c) => {
  const user = c.get("user");
  const name = parseName(await readJson(c));

  const [plan, count] = await Promise.all([
    getPlan(c.env.DB, user.id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM collections WHERE user_id = ?").bind(user.id).first<number>("n"),
  ]);
  const limit = PLAN_LIMITS[plan].collections;
  if ((count ?? 0) >= limit) {
    throw planLimit(
      "collections",
      plan,
      `Seu plano permite ${limit === 1 ? "1 coleção" : `${limit} coleções`}. Faça upgrade para criar mais.`,
    );
  }

  const row: CollectionRow = { id: newId("col"), user_id: user.id, name, created_at: nowIso() };
  await c.env.DB.prepare("INSERT INTO collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
    .bind(row.id, row.user_id, row.name, row.created_at)
    .run();
  return c.json(collectionJson(row), 201);
});

collections.patch("/:id", async (c) => {
  const name = parseName(await readJson(c));
  const row = await c.env.DB.prepare("UPDATE collections SET name = ? WHERE id = ? AND user_id = ? RETURNING *")
    .bind(name, c.req.param("id"), c.get("user").id)
    .first<CollectionRow>();
  if (!row) throw notFound(COLLECTION_NOT_FOUND);
  return c.json(collectionJson(row));
});

collections.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const exists = await c.env.DB.prepare("SELECT 1 FROM collections WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first();
  if (!exists) throw notFound(COLLECTION_NOT_FOUND);

  // Cascata explícita: lembretes → plantas → coleção.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM reminders WHERE user_id = ? AND plant_id IN (SELECT id FROM plants WHERE collection_id = ?)",
    ).bind(userId, id),
    c.env.DB.prepare("DELETE FROM plants WHERE user_id = ? AND collection_id = ?").bind(userId, id),
    c.env.DB.prepare("DELETE FROM collections WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return c.body(null, 204);
});

export default collections;
