-- Aparelho do usuário que recebe push (um por usuário: vale o último login).
ALTER TABLE users ADD COLUMN push_token TEXT;
-- Sistema do aparelho: 'android' ou 'ios'. Preenchido junto com push_token.
ALTER TABLE users ADD COLUMN push_platform TEXT CHECK (push_platform IN ('android', 'ios'));
-- Um aparelho pertence a um usuário só (troca de conta no mesmo celular).
CREATE UNIQUE INDEX idx_users_push_token ON users(push_token) WHERE push_token IS NOT NULL;
