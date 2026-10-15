-- Indicação de amigos e programa de afiliados (ver docs/API.md do app, seção 3.7, e docs/AFILIADOS.md).

-- Código que o usuário compartilha (6 caracteres, sem 0/O/1/I). Contas antigas recebem
-- o código na primeira chamada a GET /referrals.
ALTER TABLE users ADD COLUMN referral_code TEXT;
CREATE UNIQUE INDEX idx_users_referral_code ON users(referral_code);

-- Fim do Pro grátis ganho por indicação ou cupom. Cada recompensa soma dias a partir daqui
-- (ou de agora, se já venceu). O plano efetivo é o maior entre este e o da loja.
ALTER TABLE users ADD COLUMN bonus_pro_until TEXT;

-- Influenciadores parceiros. `code` é o cupom e o final do link (/a/MARINA).
CREATE TABLE affiliates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact TEXT,
  -- Dias de Pro para quem entra com o cupom (na 1ª identificação). 0 = nenhum.
  bonus_days INTEGER NOT NULL DEFAULT 7,
  -- Comissão sobre a receita líquida: first_rate nos first_months primeiros meses de cada
  -- assinante (contados do 1º pagamento dele), depois rate.
  first_rate REAL NOT NULL DEFAULT 0.20,
  first_months INTEGER NOT NULL DEFAULT 3,
  rate REAL NOT NULL DEFAULT 0.10,
  -- Segredo do painel do parceiro (/p/<token>).
  stats_token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Quem trouxe cada usuário: um amigo (referrer_id) ou um influenciador (affiliate_id).
-- Uma linha por usuário; cada conta usa no máximo um código.
CREATE TABLE referrals (
  referee_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  affiliate_id TEXT REFERENCES affiliates(id),
  -- pending: aguardando a 1ª identificação do indicado; rewarded: recompensa entregue
  status TEXT NOT NULL CHECK (status IN ('pending', 'rewarded')),
  -- 0 quando quem indicou já tinha atingido o limite de recompensas (o indicado ganha mesmo assim)
  referrer_rewarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  rewarded_at TEXT,
  CHECK ((referrer_id IS NULL) <> (affiliate_id IS NULL))
);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id, status);
CREATE INDEX idx_referrals_affiliate ON referrals(affiliate_id, created_at);

-- Cliques no link do influenciador, por dia (horário de Brasília).
CREATE TABLE affiliate_clicks (
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  day TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (affiliate_id, day)
);

-- Instalações que abriram o app vindas do link de um influenciador (Install Referrer).
-- `install_id` é gerado pelo app na primeira abertura: evita contar duas vezes.
CREATE TABLE app_installs (
  install_id TEXT PRIMARY KEY,
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_app_installs_affiliate ON app_installs(affiliate_id, created_at);

-- Cada cobrança do Google Play (compra ou renovação), identificada pelo número do pedido.
CREATE TABLE payments (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_token TEXT NOT NULL,
  plan TEXT NOT NULL,
  -- Preço do plano (bruto) e o que sobra após a taxa do Google, em centavos de real.
  amount_cents INTEGER NOT NULL,
  net_cents INTEGER NOT NULL,
  paid_at TEXT NOT NULL,
  -- Compra de testador de licença: não entra nos totais nem gera comissão.
  test INTEGER NOT NULL DEFAULT 0,
  refunded_at TEXT,
  -- Influenciador que trouxe o usuário e a comissão calculada no momento do pagamento.
  affiliate_id TEXT REFERENCES affiliates(id),
  commission_rate REAL,
  commission_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_payments_user ON payments(user_id, paid_at);
CREATE INDEX idx_payments_affiliate ON payments(affiliate_id, paid_at);

-- Pagamentos de comissão feitos aos parceiros (registrados no painel admin).
CREATE TABLE affiliate_payouts (
  id TEXT PRIMARY KEY,
  affiliate_id TEXT NOT NULL REFERENCES affiliates(id),
  amount_cents INTEGER NOT NULL,
  note TEXT,
  paid_at TEXT NOT NULL
);
CREATE INDEX idx_affiliate_payouts_affiliate ON affiliate_payouts(affiliate_id, paid_at);
