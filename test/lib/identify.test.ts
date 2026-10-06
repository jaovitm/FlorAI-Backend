import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identifyPlant } from "../../src/lib/identify";
import { sampleCare } from "../helpers";

// A API da Anthropic é mockada no `fetch`: o SDK real monta a requisição e
// interpreta a resposta, mas nada sai para a rede e a chave é falsa.
let fetchSpy: ReturnType<typeof vi.spyOn>;

const image = new Uint8Array([1, 2, 3]);
const credentials = { apiKey: "test-anthropic-key" };

const output = (overrides: Record<string, unknown> = {}) => ({
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

const message = (content: unknown[], stop_reason = "end_turn") =>
  new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5",
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } },
  );

const replyWith = (data: unknown, stop_reason?: string) =>
  fetchSpy.mockImplementation(async () => message([{ type: "text", text: JSON.stringify(data) }], stop_reason));

/** Lê a requisição que o SDK enviou. */
async function sentRequest() {
  const [input, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
  const req = new Request(input, init);
  return { url: req.url, headers: req.headers, body: await req.json<any>() };
}

describe("identifyPlant", () => {
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => vi.restoreAllMocks());

  it("envia a imagem em base64 para o modelo e devolve a planta sem o campo identified", async () => {
    replyWith(output());
    const plant = await identifyPlant(credentials, image, "image/png");

    expect(plant).toMatchObject({ plantName: "Jiboia", scientificName: "Epipremnum aureum", confidence: 0.92 });
    expect(plant).not.toHaveProperty("identified");

    const { url, headers, body } = await sentRequest();
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers.get("x-api-key")).toBe("test-anthropic-key");
    expect(headers.get("anthropic-workspace-id")).toBeNull();
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AQID" },
    });
  });

  it("envia o header de workspace quando configurado", async () => {
    replyWith(output());
    await identifyPlant({ apiKey: "k", workspaceId: "wrkspc_1" }, image, "image/jpeg");
    expect((await sentRequest()).headers.get("anthropic-workspace-id")).toBe("wrkspc_1");
  });

  it("limita confiança a [0, 1] e intervalo de rega a [1, 60]", async () => {
    replyWith(output({ confidence: 1.7, careInstructions: { ...sampleCare, wateringIntervalDays: 400 } }));
    let plant = await identifyPlant(credentials, image, "image/jpeg");
    expect(plant!.confidence).toBe(1);
    expect(plant!.careInstructions.wateringIntervalDays).toBe(60);

    replyWith(output({ confidence: -3, careInstructions: { ...sampleCare, wateringIntervalDays: 0 } }));
    plant = await identifyPlant(credentials, image, "image/jpeg");
    expect(plant!.confidence).toBe(0);
    // 0 é falsy → usa o padrão de 7 dias.
    expect(plant!.careInstructions.wateringIntervalDays).toBe(7);
  });

  it("remove curiosidades vazias e mantém no máximo 6", async () => {
    replyWith(output({ curiosities: ["a", " ", "b", "c", "d", "e", "f", "g"] }));
    const plant = await identifyPlant(credentials, image, "image/webp");
    expect(plant!.curiosities).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it.each([
    ["recusa do modelo", output(), "refusal"],
    ["resposta cortada", output(), "max_tokens"],
    ["identified=false", output({ identified: false }), undefined],
    ["nome vazio", output({ plantName: "  " }), undefined],
    ["nome científico vazio", output({ scientificName: "" }), undefined],
  ])("retorna null em caso de %s", async (_, data, stopReason) => {
    replyWith(data, stopReason);
    expect(await identifyPlant(credentials, image, "image/jpeg")).toBeNull();
  });

  it("retorna null sem bloco de texto na resposta", async () => {
    fetchSpy.mockImplementation(async () => message([]));
    expect(await identifyPlant(credentials, image, "image/jpeg")).toBeNull();
  });

  it("propaga erros da API (ex.: chave inválida)", async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(identifyPlant(credentials, image, "image/jpeg")).rejects.toMatchObject({ status: 401 });
  });
});
