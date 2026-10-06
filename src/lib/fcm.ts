import { toBase64Url } from "./crypto";

// Push via Firebase Cloud Messaging (API HTTP v1). O Firebase Admin SDK não roda
// no Workers, então assinamos o JWT da service account com a WebCrypto.

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** Campos usados do JSON da service account (secret `FIREBASE_SERVICE_ACCOUNT`). */
export type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
};

export type PushMessage = {
  title: string;
  body: string;
  /** Valores precisam ser strings (exigência do FCM). */
  data?: Record<string, string>;
};

export type PushResult =
  | { ok: true }
  /** `invalidToken`: o token não existe mais (logout, app desinstalado) e deve ser apagado. */
  | { ok: false; invalidToken: boolean; status: number; error: string };

// Canal criado pelo app Android (`FirebasePushService`).
const ANDROID_CHANNEL_ID = "push";

const encoder = new TextEncoder();

export function parseServiceAccount(json: string): ServiceAccount {
  const account = JSON.parse(json) as Partial<ServiceAccount>;
  if (!account.project_id || !account.client_email || !account.private_key || !account.token_uri) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT incompleto.");
  }
  return account as ServiceAccount;
}

async function importPrivateKey(pem: string) {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function signJwt(account: ServiceAccount, now: number) {
  const segment = (value: object) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${segment({ alg: "RS256", typ: "JWT" })}.${segment({
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const key = await importPrivateKey(account.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

// Access token reaproveitado entre requisições enquanto o isolate estiver vivo.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(account.client_email);
  if (cached && cached.expiresAt - 60 > now) return cached.token;

  const response = await fetch(account.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await signJwt(account, now),
    }),
  });
  if (!response.ok) throw new Error(`Falha ao autenticar no Google (${response.status}): ${await response.text()}`);
  const { access_token, expires_in } = await response.json<{ access_token: string; expires_in: number }>();
  tokenCache.set(account.client_email, { token: access_token, expiresAt: now + expires_in });
  return access_token;
}

/** Envia uma notificação exibida pelo sistema (canal [ANDROID_CHANNEL_ID]). */
export function sendPush(account: ServiceAccount, token: string, message: PushMessage): Promise<PushResult> {
  return deliver(account, {
    token,
    notification: { title: message.title, body: message.body },
    data: message.data,
    android: { priority: "high", notification: { channel_id: ANDROID_CHANNEL_ID } },
  });
}

/**
 * Envia só dados: o app monta a notificação (ex.: com o botão "Reguei").
 * Prioridade alta para o Android acordar o app em segundo plano.
 */
export function sendData(account: ServiceAccount, token: string, data: Record<string, string>): Promise<PushResult> {
  return deliver(account, { token, data, android: { priority: "high" } });
}

async function deliver(account: ServiceAccount, message: object): Promise<PushResult> {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await getAccessToken(account)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  if (response.ok) return { ok: true };

  const text = await response.text();
  let errorCode = "";
  try {
    const { error } = JSON.parse(text) as {
      error?: { status?: string; details?: { errorCode?: string }[] };
    };
    errorCode = error?.details?.find((d) => d.errorCode)?.errorCode ?? error?.status ?? "";
  } catch {
    // Corpo fora do padrão: fica só o status HTTP.
  }
  return {
    ok: false,
    // UNREGISTERED: token expirado ou revogado. INVALID_ARGUMENT: token mal formado.
    invalidToken: errorCode === "UNREGISTERED" || errorCode === "INVALID_ARGUMENT",
    status: response.status,
    error: errorCode || text,
  };
}
