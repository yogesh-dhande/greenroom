import { z } from "zod";
import {
  authenticateExternalRequest,
  ExternalAuthError,
  requireExternalScope,
  type ExternalAuthContext,
} from "@/lib/external-auth";

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    readonly status: ApiErrorStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestContext {
  requestId: string;
}

type ApiHandler = (context: ApiRequestContext) => Promise<Response>;

/**
 * The shared REST/MCP-facing authentication gate for a read route. The
 * credential resolver owns expiry, revocation, active-admin, and event
 * allowlist checks; routes only state the permission and resource they need.
 */
export async function authenticateApiRead(
  request: Request,
  eventId?: string,
): Promise<ExternalAuthContext> {
  const auth = await authenticateExternalRequest(request, eventId);
  requireExternalScope(auth, "read", eventId);
  return auth;
}

export function apiJson(
  body: unknown,
  context: ApiRequestContext,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("x-request-id", context.requestId);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function apiData(
  data: unknown,
  context: ApiRequestContext,
  init?: ResponseInit,
): Response {
  return apiJson({ data }, context, init);
}

export function apiCollection(
  data: unknown[],
  pagination: { page: number; pageSize: number; total: number; totalPages: number },
  context: ApiRequestContext,
): Response {
  return apiJson({ data, pagination }, context);
}

export function notFound(resource: string): never {
  throw new ApiError(404, "not_found", `${resource} not found.`);
}

/**
 * Gives every response a correlation id and translates all expected failures
 * into the v1 error envelope. No request body, Authorization value, or thrown
 * object is logged here.
 */
export async function withApiRequest(request: Request, handler: ApiHandler): Promise<Response> {
  const requestId = crypto.randomUUID();
  const context = { requestId };

  try {
    return await handler(context);
  } catch (error) {
    if (error instanceof ApiError || error instanceof ExternalAuthError) {
      const headers = new Headers();
      if (error.status === 429) {
        const retryAfter = retryAfterFrom(error.details);
        if (retryAfter) headers.set("retry-after", retryAfter);
      }
      return apiJson(
        {
          error: {
            code: error instanceof ExternalAuthError ? codeForStatus(error.status) : error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
            requestId,
          },
        },
        context,
        { status: error.status, headers },
      );
    }

    if (error instanceof z.ZodError) {
      return apiJson(
        {
          error: {
            code: "bad_request",
            message: "The request parameters are invalid.",
            details: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
            requestId,
          },
        },
        context,
        { status: 400 },
      );
    }

    return apiJson(
      {
        error: {
          code: "internal_error",
          message: "An unexpected error occurred.",
          requestId,
        },
      },
      context,
      { status: 500 },
    );
  }
}

function codeForStatus(status: ExternalAuthError["status"]): ApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "rate_limited";
}

function retryAfterFrom(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as { retryAfter?: unknown }).retryAfter;
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.max(1, Math.ceil(value)))
    : typeof value === "string" && /^\d+$/.test(value)
      ? value
      : null;
}
