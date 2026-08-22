import type { SortDirection, SortSpec } from "@/types/api";
import type { SessionStatus } from "@/types/domain";

/**
 * Query/path parameter validation for the API layer.
 *
 * Every value is validated and normalized here before reaching the data layer;
 * data-layer SQL only ever receives bound parameters.
 */

export const CANONICAL_STATUSES: SessionStatus[] = ["Failed", "Verified", "Paid", "Reversed", "NoAttempt"];
export const MAX_PAGE_SIZE = 200;
export const MAX_SORT_COLUMNS = 5;
export const MAX_KEY_LENGTH = 256;

export class ParamError extends Error {
  constructor(
    public readonly param: string,
    message: string,
    public readonly allowed?: string[]
  ) {
    super(message);
    this.name = "ParamError";
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Validates a start/end date parameter. Date-only values are expanded so the
 * range is inclusive of the whole day: start keeps 'YYYY-MM-DD' (a prefix that
 * compares correctly against both date-only and datetime values), end becomes
 * 'YYYY-MM-DD 23:59:59.999999'.
 */
function parseDateParam(value: string, key: "start" | "end"): string {
  if (DATE_ONLY_RE.test(value)) {
    if (!isRealDate(value)) {
      throw new ParamError(key, `invalid date: "${value}"`);
    }
    return key === "end" ? `${value} 23:59:59.999999` : value;
  }
  if (DATE_TIME_RE.test(value)) {
    return value;
  }
  throw new ParamError(key, `invalid date: "${value}" (expected YYYY-MM-DD or YYYY-MM-DD[ T]HH:MM[:SS[.fff]])`);
}

export interface DateRange {
  start: string | null;
  end: string | null;
}

export function parseDateRange(params: URLSearchParams): DateRange {
  const rawStart = params.get("start");
  const rawEnd = params.get("end");
  const start = rawStart === null ? null : parseDateParam(rawStart.trim(), "start");
  const end = rawEnd === null ? null : parseDateParam(rawEnd.trim(), "end");

  if (start !== null && end !== null && start > end) {
    throw new ParamError("start", `start date "${start}" is after end date "${end}"`);
  }
  return { start, end };
}

export function parsePage(params: URLSearchParams): number {
  const raw = params.get("page");
  if (raw === null || raw.trim() === "") {
    return 1;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new ParamError("page", `invalid page: "${raw}" (expected a positive integer)`);
  }
  const page = Number(raw.trim());
  if (page < 1) {
    throw new ParamError("page", `invalid page: "${raw}" (must be >= 1)`);
  }
  return page;
}

export function parsePageSize(params: URLSearchParams, defaultValue: number): number {
  const raw = params.get("page_size");
  if (raw === null || raw.trim() === "") {
    return defaultValue;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new ParamError("page_size", `invalid page_size: "${raw}" (expected a positive integer)`);
  }
  const pageSize = Number(raw.trim());
  if (pageSize < 1) {
    throw new ParamError("page_size", `invalid page_size: "${raw}" (must be >= 1)`);
  }
  if (pageSize > MAX_PAGE_SIZE) {
    throw new ParamError("page_size", `invalid page_size: "${raw}" (max ${MAX_PAGE_SIZE})`);
  }
  return pageSize;
}

export function parseStatuses(params: URLSearchParams): SessionStatus[] | null {
  const raw = params.get("status");
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const seen = new Set<SessionStatus>();
  const statuses: SessionStatus[] = [];
  for (const part of raw.split(",")) {
    const status = part.trim() as SessionStatus;
    if (!CANONICAL_STATUSES.includes(status)) {
      throw new ParamError("status", `invalid status: "${part.trim()}"`, [...CANONICAL_STATUSES]);
    }
    if (!seen.has(status)) {
      seen.add(status);
      statuses.push(status);
    }
  }
  return statuses;
}

export function parseVerification(params: URLSearchParams): "Automated" | "Manual" | null {
  const raw = params.get("verification");
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const value = raw.trim();
  if (value !== "Automated" && value !== "Manual") {
    throw new ParamError("verification", `invalid verification: "${raw}" (expected Automated or Manual)`, [
      "Automated",
      "Manual",
    ]);
  }
  return value;
}

export function parseBoolean(params: URLSearchParams, key: string): boolean | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new ParamError(key, `invalid boolean: "${raw}" (expected true/false/1/0)`);
}

export function parseNonNegativeInt(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new ParamError(key, `invalid value: "${raw}" (expected a non-negative integer)`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value)) {
    throw new ParamError(key, `invalid value: "${raw}" (number too large)`);
  }
  return value;
}

export function parsePercent(params: URLSearchParams, key: string, max = 100): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) {
    throw new ParamError(key, `invalid value: "${raw}" (expected a number between 0 and ${max})`);
  }
  const value = Number(raw.trim());
  if (value < 0 || value > max) {
    throw new ParamError(key, `invalid value: "${raw}" (must be between 0 and ${max})`);
  }
  return value;
}

export function parseStringParam(params: URLSearchParams, key: string, maxLength: number): string | null {
  const raw = params.get(key);
  if (raw === null) {
    return null;
  }
  const value = raw.trim();
  if (value === "") {
    throw new ParamError(key, `invalid value: "${key}" must not be empty`);
  }
  if (value.length > maxLength) {
    throw new ParamError(key, `invalid value: "${key}" exceeds max length ${maxLength}`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ParamError(key, `invalid value: "${key}" contains control characters`);
  }
  return value;
}

export function parseSort(
  params: URLSearchParams,
  allowedFields: Record<string, string>,
  defaults: SortSpec[]
): SortSpec[] {
  const raw = params.get("sort");
  if (raw === null || raw.trim() === "") {
    return defaults;
  }

  const parts = raw.split(",");
  if (parts.length > MAX_SORT_COLUMNS) {
    throw new ParamError("sort", `sort accepts at most ${MAX_SORT_COLUMNS} columns`);
  }

  const specs: SortSpec[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") {
      throw new ParamError("sort", `invalid sort entry: "${part}"`);
    }
    const colonIndex = trimmed.indexOf(":");
    const field = colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex);
    const directionRaw = colonIndex === -1 ? null : trimmed.slice(colonIndex + 1);

    if (!(field in allowedFields)) {
      throw new ParamError("sort", `unknown sort field: "${field}"`, Object.keys(allowedFields));
    }
    let direction: SortDirection = "desc";
    if (directionRaw !== null) {
      if (directionRaw === "asc" || directionRaw === "desc") {
        direction = directionRaw;
      } else {
        throw new ParamError("sort", `invalid sort direction: "${directionRaw}" (expected asc or desc)`, [
          "asc",
          "desc",
        ]);
      }
    }
    specs.push({ field, direction });
  }
  return specs;
}

/** Validates a decoded path segment used as a key (merchant_key / session_key). */
export function parsePathKey(value: string, key: string): string {
  if (value === "") {
    throw new ParamError(key, `invalid ${key}: must not be empty`);
  }
  if (value.length > MAX_KEY_LENGTH) {
    throw new ParamError(key, `invalid ${key}: exceeds max length ${MAX_KEY_LENGTH}`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ParamError(key, `invalid ${key}: contains control characters`);
  }
  return value;
}
