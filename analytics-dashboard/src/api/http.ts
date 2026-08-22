import { NextResponse } from "next/server";
import type { ApiErrorDetails, ApiErrorResponse, PaginationMeta } from "@/types/api";
import { ParamError } from "@/api/params";
import { DataColumnError } from "@/data/api-queries";

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: ApiErrorDetails
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = { error: { code, message, ...(details ? { details } : {}) } };
  return NextResponse.json(body, { status });
}

export function paginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1 && totalPages > 0,
  };
}

/**
 * Maps any error thrown inside a route handler to a stable error response.
 * - ParamError            -> 400 invalid_parameter
 * - DataColumnError       -> 400 invalid_parameter (filter unsupported by dataset)
 * - missing database file -> 500 database_unavailable
 * - anything else         -> 500 internal_error
 */
export function handleRouteError(err: unknown): NextResponse<ApiErrorResponse> {
  if (err instanceof ParamError) {
    return apiError(400, "invalid_parameter", err.message, {
      param: err.param,
      ...(err.allowed ? { allowed: err.allowed } : {}),
    });
  }
  if (err instanceof DataColumnError) {
    return apiError(400, "invalid_parameter", err.message, { param: err.param });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("SQLite database not found")) {
    return apiError(500, "database_unavailable", message);
  }
  console.error("[api] unexpected error:", err);
  return apiError(500, "internal_error", "An unexpected error occurred while serving the request.");
}
