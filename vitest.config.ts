import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // O workerd embutido no pool ainda não suporta a compatibility_date do wrangler.jsonc.
          compatibilityDate: "2026-08-22",
          // Chave falsa: a chamada à Anthropic é sempre mockada nos testes.
          // FIREBASE_SERVICE_ACCOUNT vazio: ignora o .dev.vars local; cada teste de push injeta uma conta falsa.
          bindings: { TEST_MIGRATIONS: migrations, ANTHROPIC_API_KEY: "test-anthropic-key", FIREBASE_SERVICE_ACCOUNT: "" },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
