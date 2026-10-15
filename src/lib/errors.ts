import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Feature, Plan } from "./plans";

export type ErrorCode =
  | "validation_error"
  | "invalid_credentials"
  | "unauthorized"
  | "plan_limit"
  | "not_found"
  | "email_taken"
  | "identification_failed"
  | "rate_limited"
  | "invalid_purchase"
  | "purchase_in_use"
  | "forbidden"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly extra: { feature?: Feature; plan?: Plan } = {},
  ) {
    super(message);
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const validationError = (message: string) => new ApiError(400, "validation_error", message);

export const notFound = (message = "Não encontrado.") => new ApiError(404, "not_found", message);

export const unauthorized = () =>
  new ApiError(401, "unauthorized", "Sua sessão expirou. Entre novamente.");

export const planLimit = (feature: Feature, plan: Plan, message: string) =>
  new ApiError(403, "plan_limit", message, { feature, plan });

export const invalidPurchase = (message: string) => new ApiError(422, "invalid_purchase", message);

export const purchaseInUse = () =>
  new ApiError(409, "purchase_in_use", "Esta assinatura pertence a outra conta do FlorAI.");
