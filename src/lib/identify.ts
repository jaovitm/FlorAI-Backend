import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { bytesToBase64 } from "./crypto";

const MODEL = "claude-haiku-4-5";

const CareItem = z.object({
  label: z.string().describe("Rótulo curto, 1 ou 2 palavras (ex.: 'Indireta', 'Pouca', 'Fácil')."),
  description: z.string().nullable().describe("Complemento curto, ou null."),
});

const IdentificationSchema = z.object({
  identified: z
    .boolean()
    .describe("false se a foto não mostra uma planta ou não dá para reconhecer a espécie."),
  plantName: z.string().describe("Nome popular mais comum no Brasil."),
  scientificName: z.string(),
  family: z.string().describe("Família botânica, ou string vazia."),
  category: z.string().describe("Ex.: 'Planta de interior', 'Suculenta', 'Frutífera'; ou string vazia."),
  confidence: z.number().describe("Confiança na espécie, de 0 a 1."),
  description: z.string().describe("De 2 a 4 frases sobre a planta."),
  careInstructions: z.object({
    light: CareItem,
    water: CareItem,
    difficulty: CareItem,
    temperature: z.string().describe("Faixa ideal, ex.: '18°C – 30°C'."),
    soil: z.string(),
    fertilizer: z.string(),
    wateringIntervalDays: z.number().int().describe("Intervalo sugerido entre regas, em dias (1 a 60)."),
    toxicity: z.string().nullable().describe("Toxicidade para pessoas/pets, ou null se não for tóxica."),
  }),
  curiosities: z.array(z.string()).describe("De 0 a 4 curiosidades curtas."),
});

export type IdentifiedPlant = Omit<z.infer<typeof IdentificationSchema>, "identified">;

const SYSTEM_PROMPT = `Você é o botânico do FlorAI, um app brasileiro que identifica plantas por foto.
Identifique a espécie da planta na foto e preencha todos os campos em português do Brasil,
com cuidados práticos para quem cultiva em casa no Brasil.
Os rótulos de luz, água e dificuldade aparecem em cards pequenos: use 1 ou 2 palavras.
Se a foto não mostrar uma planta, ou estiver impossível de reconhecer, responda identified=false
e preencha os demais campos com strings vazias, zeros e listas vazias.`;

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Identifica a planta na foto. Retorna `null` quando não é possível identificar
 * (sem planta, foto ilegível ou recusa do modelo).
 */
export async function identifyPlant(
  credentials: { apiKey: string; workspaceId?: string },
  image: Uint8Array,
  mediaType: SupportedImageType,
): Promise<IdentifiedPlant | null> {
  // O app espera no máximo 60 s: 2 tentativas de até 25 s cabem nesse prazo.
  const client = new Anthropic({
    apiKey: credentials.apiKey,
    defaultHeaders: credentials.workspaceId ? { "anthropic-workspace-id": credentials.workspaceId } : undefined,
    timeout: 25_000,
    maxRetries: 1,
  });

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(IdentificationSchema) },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: bytesToBase64(image) } },
          { type: "text", text: "Identifique esta planta." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const result = response.parsed_output;
  if (!result || !result.identified || !result.plantName.trim() || !result.scientificName.trim()) {
    return null;
  }

  const { identified: _, ...plant } = result;
  const care = plant.careInstructions;
  return {
    ...plant,
    confidence: Math.min(1, Math.max(0, plant.confidence)),
    careInstructions: {
      ...care,
      wateringIntervalDays: Math.min(60, Math.max(1, Math.round(care.wateringIntervalDays) || 7)),
    },
    curiosities: plant.curiosities.filter((s) => s.trim()).slice(0, 6),
  };
}
