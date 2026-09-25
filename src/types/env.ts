export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** Secret: chave da API da Anthropic, usada na identificação das plantas. */
  ANTHROPIC_API_KEY: string;
  /** Opcional: workspace da Anthropic, exigido quando a chave não está vinculada a um. */
  ANTHROPIC_WORKSPACE_ID?: string;
  /** Opcional: origem pública usada em `imageUrl` (padrão: origem da requisição). */
  PUBLIC_BASE_URL?: string;
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
