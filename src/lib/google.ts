// Verificação do ID token do "Continuar com Google" (JWT RS256 assinado pelo Google).
// https://developers.google.com/identity/sign-in/android/backend-auth

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
/** Tolerância de relógio na validade do token. */
const CLOCK_SKEW_S = 60;

export type GoogleIdentity = {
  /** Id estável da conta Google. */
  sub: string;
  email: string;
  name: string | null;
};

type Jwk = JsonWebKey & { kid: string };

/** Chaves públicas do Google, em cache no isolate até o `max-age` da resposta. */
let certs: { keys: Jwk[]; expiresAt: number } | null = null;

async function googleKeys(nowMs: number, refresh = false): Promise<Jwk[]> {
  if (certs && !refresh && nowMs < certs.expiresAt) return certs.keys;
  const response = await fetch(CERTS_URL);
  if (!response.ok) throw new Error(`Falha ao buscar as chaves do Google: ${response.status}`);
  const { keys } = (await response.json()) as { keys: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certs = { keys, expiresAt: nowMs + maxAge * 1000 };
  return keys;
}

const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

const decodeJson = (part: string) =>
  JSON.parse(new TextDecoder().decode(fromBase64Url(part))) as Record<string, unknown>;

/**
 * Valida o ID token (assinatura, emissor, público = [clientId], validade e e-mail
 * verificado). Retorna `null` para qualquer token inválido.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  nowMs = Date.now(),
): Promise<GoogleIdentity | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  // Chave nova (rotação): busca de novo antes de recusar.
  let jwk = (await googleKeys(nowMs)).find((k) => k.kid === header.kid);
  jwk ??= (await googleKeys(nowMs, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const now = nowMs / 1000;
  const { iss, aud, exp, iat, sub, email, email_verified, name } = payload;
  if (!ISSUERS.includes(iss as string) || aud !== clientId) return null;
  if (typeof exp !== "number" || exp < now - CLOCK_SKEW_S) return null;
  if (typeof iat === "number" && iat > now + CLOCK_SKEW_S) return null;
  if (typeof sub !== "string" || typeof email !== "string") return null;
  // O Google manda `email_verified` como boolean (ou "true" em tokens antigos).
  if (email_verified !== true && email_verified !== "true") return null;

  return { sub, email: email.toLowerCase(), name: typeof name === "string" && name.trim() ? name.trim() : null };
}

/** Só para testes: limpa o cache das chaves. */
export const resetGoogleKeysCache = () => {
  certs = null;
};
