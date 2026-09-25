const encoder = new TextEncoder();

// Limite máximo de iterações PBKDF2 aceito pela WebCrypto do Workers.
export const PBKDF2_ITERATIONS = 100_000;

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

/** ID opaco com prefixo, ex.: `plt_3f9a…`. */
export const newId = (prefix: string) => `${prefix}_${toHex(randomBytes(12))}`;

/** Token de sessão aleatório (32 bytes). */
export const newToken = () => toBase64Url(randomBytes(32));

export async function sha256Hex(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: toHex(hash), salt: toHex(salt), iterations: PBKDF2_ITERATIONS };
}

export async function verifyPassword(
  password: string,
  stored: { hash: string; salt: string; iterations: number },
) {
  const actual = await pbkdf2(password, fromHex(stored.salt), stored.iterations);
  const expected = fromHex(stored.hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
