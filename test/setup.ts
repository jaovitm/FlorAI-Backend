import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Nenhum teste pode chamar serviços externos: qualquer fetch não mockado falha.
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    throw new Error(`Rede bloqueada nos testes: ${input instanceof Request ? input.url : String(input)}`);
  });
});

afterEach(() => vi.restoreAllMocks());
