import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { newId } from "../lib/crypto";
import { notFound, planLimit, validationError } from "../lib/errors";
import { nowIso, readJson } from "../lib/http";
import { getPlan, PLAN_LIMITS } from "../lib/plans";
import { plantJson, type IdentificationRow, type PlantRow } from "../lib/serialize";

const plants = new Hono<AppEnv>();

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw validationError(`Informe ${field}.`);
  return value.trim();
};

const collectionExists = (db: D1Database, id: string, userId: string) =>
  db.prepare("SELECT 1 FROM collections WHERE id = ? AND user_id = ?").bind(id, userId).first();

plants.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM plants WHERE user_id = ? ORDER BY created_at ASC, id ASC",
  )
    .bind(c.get("user").id)
    .all<PlantRow>();
  return c.json({ items: results.map(plantJson) });
});

plants.post("/", async (c) => {
  const user = c.get("user");
  const body = await readJson(c);
  const identificationId = requireString(body.identificationId, "a identificação");
  const collectionId = requireString(body.collectionId, "a coleção");

  const [identification, collection] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM identifications WHERE id = ? AND user_id = ?")
      .bind(identificationId, user.id)
      .first<IdentificationRow>(),
    collectionExists(c.env.DB, collectionId, user.id),
  ]);
  if (!identification) throw notFound("Identificação não encontrada.");
  if (!collection) throw notFound("Coleção não encontrada.");

  const [plan, count] = await Promise.all([
    getPlan(c.env.DB, user.id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM plants WHERE user_id = ?").bind(user.id).first<number>("n"),
  ]);
  const limit = PLAN_LIMITS[plan].plants;
  if ((count ?? 0) >= limit) {
    throw planLimit("plants", plan, `Seu plano permite até ${limit} plantas. Faça upgrade para salvar mais.`);
  }

  const row: PlantRow = {
    id: newId("plt"),
    user_id: user.id,
    collection_id: collectionId,
    identification_id: identification.id,
    plant_name: identification.plant_name,
    scientific_name: identification.scientific_name,
    family: identification.family,
    category: identification.category,
    image_url: identification.image_url,
    description: identification.description,
    care_instructions: identification.care_instructions,
    curiosities: identification.curiosities,
    created_at: nowIso(),
  };
  await c.env.DB.prepare(
    `INSERT INTO plants (id, user_id, collection_id, identification_id, plant_name, scientific_name, family,
       category, image_url, description, care_instructions, curiosities, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.user_id,
      row.collection_id,
      row.identification_id,
      row.plant_name,
      row.scientific_name,
      row.family,
      row.category,
      row.image_url,
      row.description,
      row.care_instructions,
      row.curiosities,
      row.created_at,
    )
    .run();
  return c.json(plantJson(row), 201);
});

plants.patch("/:id", async (c) => {
  const user = c.get("user");
  const body = await readJson(c);
  const collectionId = requireString(body.collectionId, "a coleção");

  const plant = await c.env.DB.prepare("SELECT 1 FROM plants WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), user.id)
    .first();
  if (!plant) throw notFound("Planta não encontrada.");
  if (!(await collectionExists(c.env.DB, collectionId, user.id))) throw notFound("Coleção não encontrada.");

  const row = await c.env.DB.prepare(
    "UPDATE plants SET collection_id = ? WHERE id = ? AND user_id = ? RETURNING *",
  )
    .bind(collectionId, c.req.param("id"), user.id)
    .first<PlantRow>();
  if (!row) throw notFound("Planta não encontrada.");
  return c.json(plantJson(row));
});

plants.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("user").id;
  const [, deleted] = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM reminders WHERE plant_id = ? AND user_id = ?").bind(id, userId),
    c.env.DB.prepare("DELETE FROM plants WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  if (!deleted.meta.changes) throw notFound("Planta não encontrada.");
  return c.body(null, 204);
});

export default plants;
