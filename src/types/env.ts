export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** Secret: chave da API da Anthropic, usada na identificação das plantas. */
  ANTHROPIC_API_KEY: string;
  /** Opcional: workspace da Anthropic, exigido quando a chave não está vinculada a um. */
  ANTHROPIC_WORKSPACE_ID?: string;
  /** Opcional: origem pública usada em `imageUrl` (padrão: origem da requisição). */
  PUBLIC_BASE_URL?: string;
  /** Secret: JSON da conta de serviço com acesso ao Play Console. */
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  /** Pacote do app no Google Play, ex.: `com.florai`. */
  PLAY_PACKAGE_NAME: string;
  /** Secret: valor do `?secret=` configurado na assinatura push do Pub/Sub. */
  PLAY_WEBHOOK_SECRET: string;
  /** Secret: senha do painel de afiliados (`/admin`). Sem ela o painel fica desligado. */
  ADMIN_TOKEN?: string;
  /** `"true"` libera `POST /subscription` (troca de plano sem pagamento). Deixe desligado em produção. */
  ALLOW_TEST_SUBSCRIPTIONS?: string;
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  display_name: string | null;
  has_completed_onboarding: number;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  tz_offset: number;
  created_at: string;
  play_account_id: string | null;
  /** Código que o usuário compartilha no programa de indicação. */
  referral_code: string | null;
  /** Fim do Pro grátis ganho por indicações (ISO UTC). */
  bonus_pro_until: string | null;
};

export type Variables = {
  user: UserRow;
  tokenHash: string;
  /** Minutos em relação ao UTC (header `X-Timezone-Offset` ou último valor salvo). */
  tzOffset: number;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
