import { describe, expect, it } from "vitest";
import { anthropicPlant, api, env, imageForm, insertIdentification, mockAnthropic, setPlan, signup } from "../helpers";

const usageToday = (userId: string) =>
  env.DB.prepare("SELECT identifications FROM daily_usage WHERE user_id = ?").bind(userId).first<number>("identifications");

describe("POST /identifications", () => {
  it("identifica pela IA (mockada), salva a foto no R2 e conta no uso do dia", async () => {
    const fetchSpy = mockAnthropic(anthropicPlant({ plantName: "  Jiboia  " }));
    const { token, user } = await signup();

    const res = await api("POST", "/identifications", { token, body: imageForm("image/png") });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      id: expect.stringMatching(/^idn_[0-9a-f]+$/),
      plantName: "Jiboia",
      scientificName: "Epipremnum aureum",
      confidence: 0.92,
      imageUrl: expect.stringMatching(/^http:\/\/localhost\/images\/idn_[0-9a-f]+\.png$/),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const object = await env.BUCKET.get(`identifications/${res.json.id}.png`);
    expect(object?.httpMetadata?.contentType).toBe("image/png");
    expect(object?.customMetadata).toEqual({ userId: user.id });
    expect(await usageToday(user.id)).toBe(1);

    // A imagem é pública em /images.
    const image = await api("GET", `/images/${res.json.id}.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(image.headers.get("ETag")).toBeTruthy();
  });

  it("usa PUBLIC_BASE_URL no imageUrl quando definido", async () => {
    mockAnthropic(anthropicPlant());
    const { token } = await signup();
    const previous = env.PUBLIC_BASE_URL;
    env.PUBLIC_BASE_URL = "https://api.florai.cc/";
    try {
      const res = await api("POST", "/identifications", { token, body: imageForm() });
      expect(res.json.imageUrl).toMatch(/^https:\/\/api\.florai\.cc\/images\/idn_[0-9a-f]+\.jpg$/);
    } finally {
      env.PUBLIC_BASE_URL = previous;
    }
  });

  it("aceita image/jpg como JPEG", async () => {
    mockAnthropic(anthropicPlant());
    const { token } = await signup();
    const res = await api("POST", "/identifications", { token, body: imageForm("image/jpg") });
    expect(res.status).toBe(201);
    expect(res.json.imageUrl).toMatch(/\.jpg$/);
  });

  it.each([
    ["sem campo image", () => new FormData(), "Envie a foto no campo image."],
    ["formato não suportado", () => imageForm("image/gif"), "Formato de foto não suportado. Use JPEG, PNG ou WebP."],
    ["arquivo vazio", () => imageForm("image/jpeg", new Uint8Array()), "A foto enviada está vazia."],
    [
      "arquivo maior que 5 MB",
      () => imageForm("image/jpeg", new Uint8Array(5 * 1024 * 1024 + 1)),
      "A foto é muito grande. Envie uma imagem de até 5 MB.",
    ],
  ])("valida a foto: %s", async (_, makeForm, message) => {
    const fetchSpy = mockAnthropic(anthropicPlant());
    const { token } = await signup();
    const res = await api("POST", "/identifications", { token, body: makeForm() });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toBe(message);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("422 quando a IA não reconhece a planta; não grava nem conta no limite", async () => {
    mockAnthropic(anthropicPlant({ identified: false }));
    const { token, user } = await signup();
    const res = await api("POST", "/identifications", { token, body: imageForm() });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("identification_failed");
    expect(await usageToday(user.id)).toBeNull();
    expect((await api("GET", "/identifications", { token })).json.items).toEqual([]);
  });

  it("502 quando a API da Anthropic falha (ex.: chave inválida)", async () => {
    mockAnthropic(null, { status: 401 });
    const { token, user } = await signup();
    const res = await api("POST", "/identifications", { token, body: imageForm() });
    expect(res.status).toBe(502);
    expect(res.json.error).toEqual({
      code: "internal_error",
      message: "Não foi possível identificar a planta agora. Tente novamente em instantes.",
    });
    expect(await usageToday(user.id)).toBeNull();
  });

  it("free: bloqueia após 3 identificações no dia, antes de chamar a IA", async () => {
    const fetchSpy = mockAnthropic(anthropicPlant());
    const { token, user } = await signup();
    for (let i = 0; i < 3; i++) {
      expect((await api("POST", "/identifications", { token, body: imageForm() })).status).toBe(201);
    }
    expect(await usageToday(user.id)).toBe(3);

    const res = await api("POST", "/identifications", { token, body: imageForm() });
    expect(res.status).toBe(403);
    expect(res.json.error).toEqual({
      code: "plan_limit",
      message: "Você atingiu o limite diário de identificações.",
      feature: "dailyIdentifications",
      plan: "free",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    await setPlan(token, "basic");
    expect((await api("POST", "/identifications", { token, body: imageForm() })).status).toBe(201);
  });
});

describe("GET /identifications", () => {
  it("lista do mais recente para o mais antigo, só do usuário", async () => {
    const a = await signup();
    const b = await signup();
    const old = await insertIdentification(a.user.id, { identified_at: "2026-01-01T00:00:00.000Z" });
    const recent = await insertIdentification(a.user.id, { identified_at: "2026-02-01T00:00:00.000Z" });
    await insertIdentification(b.user.id);

    const res = await api("GET", "/identifications", { token: a.token });
    expect(res.json.items.map((i: any) => i.id)).toEqual([recent, old]);
    expect(res.json.items[0].careInstructions.light.label).toBe("Indireta");
  });

  it("respeita ?limit (padrão 50, máximo 200, inválido vira 50)", async () => {
    const { token, user } = await signup();
    for (let i = 0; i < 3; i++) await insertIdentification(user.id);
    expect((await api("GET", "/identifications?limit=2", { token })).json.items).toHaveLength(2);
    expect((await api("GET", "/identifications?limit=0", { token })).json.items).toHaveLength(3);
    expect((await api("GET", "/identifications?limit=abc", { token })).json.items).toHaveLength(3);
    expect((await api("GET", "/identifications?limit=9999", { token })).json.items).toHaveLength(3);
  });
});

describe("GET /images/:file", () => {
  it("404 para imagem inexistente", async () => {
    const res = await api("GET", "/images/idn_abc123.jpg");
    expect(res.status).toBe(404);
    expect(res.json.error.message).toBe("Imagem não encontrada.");
  });

  it("nomes fora do padrão não casam com a rota", async () => {
    await env.BUCKET.put("identifications/segredo.txt", "x");
    expect((await api("GET", "/images/segredo.txt")).status).toBe(404);
    expect((await api("GET", "/images/idn_abc.gif")).status).toBe(404);
  });
});
