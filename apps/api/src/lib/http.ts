import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends HTTPException {
  readonly code: string;
  readonly issues?: unknown;
  constructor(status: ContentfulStatusCode, code: string, message: string, issues?: unknown) {
    super(status, { message });
    this.code = code;
    this.issues = issues;
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);
export const unauthorized = () => new ApiError(401, "unauthorized", "Sign in required");
export const badRequest = (message: string, issues?: unknown) =>
  new ApiError(400, "bad_request", message, issues);

export function errorBody(code: string, message: string, issues?: unknown) {
  return { error: { code, message, ...(issues !== undefined ? { issues } : {}) } };
}

export function handleError(err: Error, c: Context): Response {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message, err.issues), err.status);
  }
  if (err instanceof HTTPException) {
    return c.json(errorBody("http_error", err.message), err.status);
  }
  console.error("Unhandled error", err);
  return c.json(errorBody("internal_error", "Something went wrong"), 500);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
