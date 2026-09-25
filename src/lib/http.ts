import type { Context } from "hono";
import type { AppEnv } from "../types/env";
import { validationError } from "./errors";

export const nowIso = () => new Date().toISOString();

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** Lê o corpo JSON como objeto; qualquer outra coisa vira `400 validation_error`. */
export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw validationError("Corpo da requisição inválido.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationError("Corpo da requisição inválido.");
  }
  return body as Record<string, unknown>;
}

/** Converte `X-Timezone-Offset` (minutos) em número válido, ou `undefined`. */
export function parseTzOffset(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < -14 * 60 || n > 14 * 60) return undefined;
  return n;
}

/** Dia local do usuário (`yyyy-MM-dd`) = UTC agora + offset. */
export const localDay = (tzOffset: number) =>
  new Date(Date.now() + tzOffset * 60_000).toISOString().slice(0, 10);

/** Converte uma data ISO recebida do app em ISO UTC normalizado, ou `null` se inválida. */
export function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const publicOrigin = (c: Context<AppEnv>) =>
  (c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin).replace(/\/+$/, "");
