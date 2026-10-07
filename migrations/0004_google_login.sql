-- Login com Google: `sub` (id estável da conta Google) vinculado ao usuário.
-- Contas criadas só pelo Google não têm senha: password_hash/salt vazios e
-- password_iterations = 0 (o login por senha recusa essas contas).
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
