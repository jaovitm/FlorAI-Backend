-- Dados de desenvolvimento local, aplicados pelo docker compose (nunca em produção).
-- Conta de teste:
--   e-mail: teste@florai.dev
--   senha:  florai-42d022
-- Senha em PBKDF2-SHA256, 100.000 iterações (mesmo formato de src/lib/crypto.ts).

INSERT OR IGNORE INTO users (
  id, name, email, display_name, has_completed_onboarding,
  password_hash, password_salt, password_iterations, tz_offset, created_at
) VALUES (
  'usr_dev000000000000000000001', 'Teste', 'teste@florai.dev', 'Teste', 1,
  'aa5f06011d2f66be50a10304ad005ee6a21ceb043bc781a53fd7788e70a868e7',
  'eba07ea4410eadaf9ae827d33107317a', 100000, -180, '2026-01-01T00:00:00.000Z'
);

-- Plano pago, para testar lembretes e pushes de rega (recurso dos planos com alertas).
INSERT OR IGNORE INTO subscriptions (user_id, plan, started_at, renews_at)
VALUES ('usr_dev000000000000000000001', 'basic', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
