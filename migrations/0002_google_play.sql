-- Assinaturas compradas pelo Google Play (ver docs/GOOGLE_PLAY_BACKEND.md no repositório do app).

-- SHA-256 (hex) do id do usuário: é o obfuscatedAccountId que o app grava na compra.
-- Permite achar o dono de uma compra que chega pelo webhook antes de o app enviá-la.
ALTER TABLE users ADD COLUMN play_account_id TEXT;
CREATE UNIQUE INDEX idx_users_play_account ON users(play_account_id);

CREATE TABLE play_purchases (
  purchase_token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('basic', 'pro', 'premium')),
  -- subscriptionState do Google, ex.: SUBSCRIPTION_STATE_ACTIVE
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  -- Fim do período pago atual (muda a cada renovação; o token não muda)
  expires_at TEXT NOT NULL,
  auto_renewing INTEGER NOT NULL DEFAULT 0,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  -- Troca de plano: o token novo aponta para o antigo, que deixa de valer
  linked_purchase_token TEXT,
  superseded INTEGER NOT NULL DEFAULT 0,
  latest_order_id TEXT,
  test_purchase INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_play_purchases_user ON play_purchases(user_id);
