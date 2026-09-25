import { Hono } from "hono";
import type { AppEnv } from "../types/env";
import { notFound } from "../lib/errors";

// Público: `imageUrl` precisa abrir sem token. Os nomes são IDs aleatórios.
const images = new Hono<AppEnv>();

images.get("/:file{idn_[0-9a-f]+\\.(?:jpg|png|webp)}", async (c) => {
  const object = await c.env.BUCKET.get(`identifications/${c.req.param("file")}`);
  if (!object) throw notFound("Imagem não encontrada.");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});

export default images;
