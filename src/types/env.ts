export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  /** Secret: chave da API da Anthropic, usada na identificação das plantas. */
  ANTHROPIC_API_KEY: string;
  /** Opcional: workspace da Anthropic, exigido quando a chave não está vinculada a um. */
  ANTHROPIC_WORKSPACE_ID?: string;
  /** Opcional: origem pública usada em `imageUrl` (padrão: origem da requisição). */
  PUBLIC_BASE_URL?: string;
  /** Opcional (secret): JSON da service account do Firebase, usado para enviar push (FCM). */
  FIREBASE_SERVICE_ACCOUNT?: string;
  /** ID do cliente OAuth "Web" do Google: público esperado no ID token do login com Google. */
  GOOGLE_CLIENT_ID: string;
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  display_name: string | null;
  has_completed_onboarding: number;
  /** Vazio em contas criadas só pelo Google (`password_iterations` = 0). */
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  /** Conta Google vinculada (login com Google). */
  google_sub: string | null;
  tz_offset: number;
  /** Token FCM do aparelho que recebe push (último login). */
  push_token: string | null;
  /** Sistema do aparelho de `push_token`. */
  push_platform: "android" | "ios" | null;
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
