import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { newId } from "../lib/crypto";
import { ApiError, planLimit, validationError } from "../lib/errors";
import { localDay, nowIso, publicOrigin } from "../lib/http";
import { identifyPlant, type SupportedImageType } from "../lib/identify";
import { getPlan, PLAN_LIMITS } from "../lib/plans";
import { identificationJson, type IdentificationRow } from "../lib/serialize";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<SupportedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const identifications = new Hono<AppEnv>();

identifications.post("/", async (c) => {
  const user = c.get("user");
  const day = localDay(c.get("tzOffset"));

  // 1. Limite diário do plano.
  const [plan, usage] = await Promise.all([
    getPlan(c.env.DB, user.id),
    c.env.DB.prepare("SELECT identifications FROM daily_usage WHERE user_id = ? AND day = ?")
      .bind(user.id, day)
      .first<{ identifications: number }>(),
  ]);
  if ((usage?.identifications ?? 0) >= PLAN_LIMITS[plan].dailyIdentifications) {
    throw planLimit("dailyIdentifications", plan, "Você atingiu o limite diário de identificações.");
  }

  // Foto enviada no campo `image`.
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw validationError("Envie a foto no campo image.");
  }
  const file = form.image;
  if (!(file instanceof File)) throw validationError("Envie a foto no campo image.");
  const mediaType = (file.type === "image/jpg" ? "image/jpeg" : file.type) as SupportedImageType;
  if (!(mediaType in EXTENSIONS)) throw validationError("Formato de foto não suportado. Use JPEG, PNG ou WebP.");
  if (file.size === 0) throw validationError("A foto enviada está vazia.");
  if (file.size > MAX_IMAGE_BYTES) throw validationError("A foto é muito grande. Envie uma imagem de até 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());

  // 3. Identificação pela IA (antes de gravar, para não deixar fotos órfãs no R2).
  let plant;
  try {
    plant = await identifyPlant(
      { apiKey: c.env.ANTHROPIC_API_KEY, workspaceId: c.env.ANTHROPIC_WORKSPACE_ID },
      bytes,
      mediaType,
    );
  } catch (err) {
    console.error("Falha ao chamar a IA de identificação", err);
    throw new ApiError(
      502,
      "internal_error",
      "Não foi possível identificar a planta agora. Tente novamente em instantes.",
    );
  }
  // 4. Sem identificação: não grava nada e não conta no limite.
  if (!plant) {
    throw new ApiError(
      422,
      "identification_failed",
      "Não conseguimos identificar a planta nesta foto. Tente outra foto, com a planta bem enquadrada e iluminada.",
    );
  }

  // 2. Foto no R2.
  const id = newId("idn");
  const fileName = `${id}.${EXTENSIONS[mediaType]}`;
  const imageKey = `identifications/${fileName}`;
  await c.env.BUCKET.put(imageKey, bytes, {
    httpMetadata: { contentType: mediaType, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { userId: user.id },
  });

  // 5. Histórico + contador do dia.
  const row: IdentificationRow = {
    id,
    user_id: user.id,
    plant_name: plant.plantName.trim(),
    scientific_name: plant.scientificName.trim(),
    family: plant.family.trim(),
    category: plant.category.trim(),
    confidence: plant.confidence,
    image_key: imageKey,
    image_url: `${publicOrigin(c)}/images/${fileName}`,
    description: plant.description.trim(),
    care_instructions: JSON.stringify(plant.careInstructions),
    curiosities: JSON.stringify(plant.curiosities),
    identified_at: nowIso(),
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO identifications (id, user_id, plant_name, scientific_name, family, category, confidence,
         image_key, image_url, description, care_instructions, curiosities, identified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id,
      row.user_id,
      row.plant_name,
      row.scientific_name,
      row.family,
      row.category,
      row.confidence,
      row.image_key,
      row.image_url,
      row.description,
      row.care_instructions,
      row.curiosities,
      row.identified_at,
    ),
    c.env.DB.prepare(
      `INSERT INTO daily_usage (user_id, day, identifications) VALUES (?, ?, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET identifications = identifications + 1`,
    ).bind(user.id, day),
  ]);

  return c.json(identificationJson(row), 201);
});

identifications.get("/", async (c) => {
  const requested = Number(c.req.query("limit") ?? 50);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : 50;
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM identifications WHERE user_id = ? ORDER BY identified_at DESC LIMIT ?",
  )
    .bind(c.get("user").id, limit)
    .all<IdentificationRow>();
  return c.json({ items: results.map(identificationJson) });
});

export default identifications;
