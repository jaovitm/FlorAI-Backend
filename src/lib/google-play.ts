import type { Bindings } from "../types/env";
import type { Plan } from "./plans";

/** Assinaturas do Play Console → planos. Mantenha igual ao `PlanCatalog` do app. */
export const PLAY_PRODUCTS: Record<string, Exclude<Plan, "free">> = {
  florai_basic: "basic",
  florai_pro: "pro",
  florai_premium: "premium",
};

export type PlaySubscriptionState =
  | "SUBSCRIPTION_STATE_UNSPECIFIED"
  | "SUBSCRIPTION_STATE_PENDING"
  | "SUBSCRIPTION_STATE_ACTIVE"
  | "SUBSCRIPTION_STATE_PAUSED"
  | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  | "SUBSCRIPTION_STATE_ON_HOLD"
  | "SUBSCRIPTION_STATE_CANCELED"
  | "SUBSCRIPTION_STATE_EXPIRED"
  | "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";

/** Resposta de `purchases.subscriptionsv2.get` (só os campos usados aqui). */
export type PlaySubscription = {
  subscriptionState: PlaySubscriptionState;
  startTime?: string;
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: "ACKNOWLEDGEMENT_STATE_PENDING" | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  /** Presente (objeto vazio) em compras de testadores de licença. */
  testPurchase?: Record<string, never>;
  lineItems: {
    productId: string;
    expiryTime?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }[];
};

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

/** Consulta a assinatura. `null` quando o Google não reconhece o token. */
export async function getPlaySubscription(env: Bindings, token: string): Promise<PlaySubscription | null> {
  const url = `${API}/${env.PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken(env)}` } });
  // 400: token malformado; 404: desconhecido; 410: expirou há tempo demais para consulta.
  if (res.status === 400 || res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`Google Play subscriptionsv2.get ${res.status}: ${await res.text()}`);
  return res.json<PlaySubscription>();
}

/**
 * Confirma a entrega da assinatura. Sem isso o Google reembolsa a compra em 3 dias.
 * Retorna `false` se falhou; o app também confirma, então não interrompa o fluxo por isso.
 */
export async function acknowledgePlaySubscription(env: Bindings, productId: string, token: string) {
  const url =
    `${API}/${env.PLAY_PACKAGE_NAME}/purchases/subscriptions/${encodeURIComponent(productId)}` +
    `/tokens/${encodeURIComponent(token)}:acknowledge`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(env)}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) console.warn(`Google Play acknowledge ${res.status}: ${await res.text()}`);
  return res.ok;
}

// ---- OAuth da conta de serviço -------------------------------------------------------------

type ServiceAccount = { client_email: string; private_key: string };

// Um token por isolate do Worker; vale 1 h.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(env: Bindings): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${await res.text()}`);
  const data = await res.json<{ access_token: string; expires_in: number }>();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function base64Url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string) {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
