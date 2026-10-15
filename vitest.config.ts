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
          // ALLOW_TEST_SUBSCRIPTIONS: o helper setPlan troca de plano por POST /subscription (desligado em produção).
          // ADMIN_TOKEN fixo: ignora o .dev.vars local.
          bindings: {
            TEST_MIGRATIONS: migrations,
            ANTHROPIC_API_KEY: "test-anthropic-key",
            FIREBASE_SERVICE_ACCOUNT: "",
            ALLOW_TEST_SUBSCRIPTIONS: "true",
            ADMIN_TOKEN: "test-admin-token",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
