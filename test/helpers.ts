import { vi } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "../src/index";
import type { Plan } from "../src/lib/plans";

export { env };

type Options = { token?: string; body?: unknown; headers?: Record<string, string> };

/** Chama a API em memória, com os bindings de teste. */
export async function api(method: string, path: string, { token, body, headers = {} }: Options = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  const h = init.headers as Record<string, string>;
  if (token) h.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await app.request(path, init, env);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

let counter = 0;
export const uniqueEmail = () => `user${Date.now()}_${counter++}_${Math.random().toString(36).slice(2, 8)}@test.dev`;

/** Cria um usuário novo e devolve token + dados. */
export async function signup(overrides: { name?: string; email?: string; password?: string } = {}) {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? "secret123";
  const res = await api("POST", "/auth/signup", { body: { name: overrides.name ?? "Maria", email, password } });
  if (res.status !== 201) throw new Error(`signup falhou: ${res.status} ${JSON.stringify(res.json)}`);
  return { token: res.json.token as string, user: res.json.user, email, password };
}

export async function setPlan(token: string, plan: Plan) {
  const res = await api("POST", "/subscription", { token, body: { plan } });
  if (res.status !== 200) throw new Error(`troca de plano falhou: ${res.status}`);
}

export const sampleCare = {
  light: { label: "Indireta", description: null },
  water: { label: "Pouca", description: "Deixe secar" },
  difficulty: { label: "Fácil", description: null },
  temperature: "18°C – 30°C",
  soil: "Bem drenado",
  fertilizer: "A cada 2 meses",
  wateringIntervalDays: 7,
  toxicity: null,
};

/** Insere uma identificação direto no D1 (sem passar pela IA). */
export async function insertIdentification(userId: string, overrides: Partial<{ id: string; identified_at: string }> = {}) {
  const id = overrides.id ?? `idn_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await env.DB.prepare(
    `INSERT INTO identifications (id, user_id, plant_name, scientific_name, family, category, confidence,
       image_key, image_url, description, care_instructions, curiosities, identified_at)
     VALUES (?, ?, 'Jiboia', 'Epipremnum aureum', 'Araceae', 'Planta de interior', 0.9,
       ?, ?, 'Trepadeira.', ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      `identifications/${id}.jpg`,
      `http://localhost/images/${id}.jpg`,
      JSON.stringify(sampleCare),
      JSON.stringify(["Purifica o ar"]),
      overrides.identified_at ?? new Date().toISOString(),
    )
    .run();
  return id;
}

export async function createCollection(token: string, name = "Sala") {
  const res = await api("POST", "/collections", { token, body: { name } });
  if (res.status !== 201) throw new Error(`coleção falhou: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.id as string;
}

/** Cria identificação + planta salva numa coleção. */
export async function createPlant(token: string, userId: string, collectionId?: string) {
  const col = collectionId ?? (await createCollection(token));
  const identificationId = await insertIdentification(userId);
  const res = await api("POST", "/plants", { token, body: { identificationId, collectionId: col } });
  if (res.status !== 201) throw new Error(`planta falhou: ${res.status} ${JSON.stringify(res.json)}`);
  return { plantId: res.json.id as string, collectionId: col, identificationId };
}

/** Resposta estruturada que o modelo devolveria para uma planta identificada. */
export const anthropicPlant = (overrides: Record<string, unknown> = {}) => ({
  identified: true,
  plantName: "Jiboia",
  scientificName: "Epipremnum aureum",
  family: "Araceae",
  category: "Planta de interior",
  confidence: 0.92,
  description: "Trepadeira resistente.",
  careInstructions: { ...sampleCare },
  curiosities: ["Purifica o ar"],
  ...overrides,
});

/**
 * Faz o `fetch` para api.anthropic.com responder com `data` (ou com um erro HTTP).
 * Retorna o spy para inspecionar as chamadas.
 */
export function mockAnthropic(data: unknown, { status = 200 }: { status?: number } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://api.anthropic.com/")) throw new Error(`Rede bloqueada nos testes: ${url}`);
    if (status !== 200) {
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "falha" } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: JSON.stringify(data) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

export const imageForm = (type = "image/jpeg", bytes: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), name = "foto.jpg") => {
  const form = new FormData();
  form.append("image", new File([bytes], name, { type }));
  return form;
};
