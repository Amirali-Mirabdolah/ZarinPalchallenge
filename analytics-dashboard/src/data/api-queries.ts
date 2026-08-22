import { getDatabase } from "@/data/db";
import { hasPaymentColumn, pickPaymentColumn } from "@/data/columns";
import type {
  ClusterRow,
  EvidenceLink,
  EvidenceSessionRef,
  MerchantListRow,
  MerchantSessionRow,
  MerchantSessionsResponse,
  MerchantSummaryResponse,
  OutcomeMixEntry,
  SessionDetailResponse,
  SortSpec,
  VerificationModeRow,
} from "@/types/api";
import type { SessionStatus } from "@/types/domain";

/**
 * API data-access layer.
 *
 * All queries here operate at the same grain and with the same rollup
 * semantics as `src/data/aggregates.ts` (session-grain authoritative,
 * `MAX(amount)` per session so repeated attempts never double-count,
 * `retry_count = attempt_count - 1`, fail rates bounded to 0..100).
 *
 * Every user-controlled value is passed through bound SQL parameters; sort
 * fields are resolved exclusively through the allowlists below.
 */

// ---------------------------------------------------------------------------
// Priority-signal thresholds (deterministic, documented defaults; see
// OpenSpec/03 "Priority signals" and OpenSpec/07 merchant table badges).
// ---------------------------------------------------------------------------

export const PRIORITY_THRESHOLDS = {
  /** Top decile of failed_value among the filtered merchant set. */
  failedValueTopQuantile: 0.9,
  /** retry_loss_value must be at least this share of failed_value. */
  retryLossShareOfFailed: 0.5,
  /** category_delta (pp) at or above which the rate is "materially worse". */
  failureRateDeltaPp: 5,
  /** automated share at or above which the mix is "excessive". */
  automatedShareMin: 0.8,
} as const;

// ---------------------------------------------------------------------------
// Sort allowlists (constant maps: no user text is ever interpolated into SQL)
// ---------------------------------------------------------------------------

export const MERCHANT_SORT_FIELDS: Record<string, string> = {
  merchant_key: "merchant_key",
  merchant_name: "merchant_name",
  sessions: "sessions",
  failed_sessions: "failed_sessions",
  failed_session_rate: "failed_session_rate",
  failed_value: "failed_value",
  retry_sessions: "retry_sessions",
  retry_sessions_share: "retry_sessions_share",
  retry_loss_value: "retry_loss_value",
  automated_share: "automated_share",
  total_value: "total_value",
  category_delta: "category_delta",
  category_median_failed_session_rate: "category_median_failed_session_rate",
  last_7d_failed_value: "last_7d_failed_value",
  last_7d_change: "last_7d_change",
};

export const DEFAULT_MERCHANT_SORT: SortSpec[] = [
  { field: "failed_value", direction: "desc" },
  { field: "retry_loss_value", direction: "desc" },
  { field: "failed_session_rate", direction: "desc" },
  { field: "category_delta", direction: "desc" },
];

export const SESSION_SORT_FIELDS: Record<string, string> = {
  session_key: "session_key",
  session_status: "session_status",
  amount: "amount",
  failed_value: "CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END",
  attempt_count: "attempt_count",
  retry_count: "retry_count",
  created_at: "created_at",
  first_try_created_at: "first_try_created_at",
  last_try_created_at: "last_try_created_at",
  try_seq_last: "try_seq_last",
};

export const DEFAULT_SESSION_SORT: SortSpec[] = [
  { field: "failed_value", direction: "desc" },
  { field: "amount", direction: "desc" },
  { field: "created_at", direction: "desc" },
];

const CANONICAL_STATUSES: SessionStatus[] = ["Failed", "Verified", "Paid", "Reversed", "NoAttempt"];

const RESPONSE_CODE_COLUMNS = ["try_response_code", "response_code"];
const PSP_COLUMNS = ["psp", "psp_code"];
const TERMINAL_COLUMNS = ["terminal", "terminal_id"];
const ISSUER_BANK_COLUMNS = ["issuer_bank", "issuer_bank_code", "bank_code"];

// ---------------------------------------------------------------------------
// created_at format handling
// ---------------------------------------------------------------------------

type CreatedAtMode = "text" | "number";
type NumericUnit = "seconds" | "milliseconds";

let createdAtMode: CreatedAtMode | null = null;
let numericUnit: NumericUnit = "seconds";

const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;

function detectCreatedAtMode(): CreatedAtMode {
  const rows = getDatabase()
    .prepare("SELECT created_at FROM payments WHERE created_at IS NOT NULL LIMIT 5")
    .all() as Array<{ created_at: unknown }>;

  if (rows.length === 0) {
    return "text";
  }
  const allNumeric = rows.every(
    (row) =>
      typeof row.created_at === "number" ||
      (typeof row.created_at === "string" && /^-?\d+(\.\d+)?$/.test(row.created_at))
  );
  if (allNumeric) {
    const first = Number(rows[0].created_at);
    numericUnit = Math.abs(first) > 1e11 ? "milliseconds" : "seconds";
    return "number";
  }
  return "text";
}

function createdAtModeValue(): CreatedAtMode {
  if (createdAtMode === null) {
    createdAtMode = detectCreatedAtMode();
  }
  return createdAtMode;
}

function createdAtNumericUnit(): NumericUnit {
  return numericUnit;
}

function parseDateTime(input: string): Date {
  const match = DATE_TIME_RE.exec(input.trim());
  if (!match) {
    throw new Error(`Unsupported created_at format: ${input}`);
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour ?? 0),
      Number(minute ?? 0),
      Number(second ?? 0)
    )
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Re-format a Date into the same textual style as `original`. */
function formatLike(original: string, date: Date): string {
  const hasTime = /[T ]\d{2}:\d{2}/.test(original);
  const separator = original.includes("T") ? "T" : " ";
  const datePart = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  if (!hasTime) {
    return datePart;
  }
  const fractionMatch = /\.(\d+)/.exec(original);
  const fraction = fractionMatch ? `.${fractionMatch[1]}` : "";
  return `${datePart}${separator}${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(
    date.getUTCSeconds()
  )}${fraction}`;
}

/**
 * Convert a normalized 'YYYY-MM-DD[ HH:MM:SS[.fff]]' string into the value
 * used for comparisons against the dataset's created_at column.
 */
function compareValue(input: string): string | number {
  if (createdAtModeValue() === "number") {
    const ms = parseDateTime(input).getTime();
    return createdAtNumericUnit() === "milliseconds" ? ms : Math.floor(ms / 1000);
  }
  return input;
}

/** Subtract `days` from a dataset/user timestamp value (text or numeric). */
function subtractDays(value: string | number, days: number): string | number {
  if (createdAtModeValue() === "number") {
    const unitMs = createdAtNumericUnit() === "milliseconds" ? 1 : 1000;
    return Number(value) - days * 86400 * 1000 / unitMs;
  }
  return formatLike(String(value), new Date(parseDateTime(String(value)).getTime() - days * 86400 * 1000));
}

/**
 * Comparison fragment for created_at boundaries. In numeric mode the value is
 * explicitly cast so the comparison is numeric even on CTE columns (which have
 * no affinity — without the cast SQLite's type ordering would rank every TEXT
 * value above every number). In text mode a plain lexicographic comparison is
 * used, which is correct for uniform timestamp formats.
 */
function createdAtBound(operator: ">=" | "<=", value: string): SqlFragment {
  const bound = compareValue(value);
  if (createdAtModeValue() === "number") {
    return frag(`CAST(created_at AS REAL) ${operator} ?`, bound);
  }
  return frag(`created_at ${operator} ?`, bound);
}

/** End of the "last 7 days" window: the `end` param when given, else the newest row in the dataset. */
function resolveWindowEnd(endParam: string | null): string | number | null {
  if (endParam) {
    return endParam;
  }
  const row = getDatabase()
    .prepare("SELECT MAX(created_at) AS max_created_at FROM payments")
    .get() as { max_created_at: string | number | null } | undefined;
  return row?.max_created_at ?? null;
}

// ---------------------------------------------------------------------------
// Shared CTE building
// ---------------------------------------------------------------------------

interface SqlFragment {
  sql: string;
  params: unknown[];
}

function frag(sql: string, ...params: unknown[]): SqlFragment {
  return { sql, params };
}

const ROLLUP_SELECT = `
    session_key,
    merchant_key,
    category_id,
    category_title,
    MAX(amount) AS amount,
    MAX(session_status) AS session_status,
    MAX(created_at) AS created_at,
    MAX(verify_type) AS verify_type,
    MIN(CASE WHEN try_seq > 0 THEN try_created_at END) AS first_try_created_at,
    MAX(CASE WHEN try_seq > 0 THEN try_created_at END) AS last_try_created_at,
    MAX(try_seq) AS try_seq_last,
    COUNT(CASE WHEN try_seq > 0 THEN 1 END) AS attempt_count`;

/** Rollup select list; includes merchant_name when the dataset exposes it. */
function buildRollupSelect(): string {
  return hasPaymentColumn("merchant_name")
    ? `${ROLLUP_SELECT},\n    MAX(merchant_name) AS merchant_name`
    : ROLLUP_SELECT;
}

/**
 * Builds the `session_rollup` + `sessions` CTE pair. Row-level filters apply to
 * the raw payments scan; session-level filters apply after the session grain
 * rollup. Params are collected in declaration order.
 */
function buildSessionsCte(
  extraCtes: SqlFragment[],
  scope: SqlFragment,
  rowFilters: SqlFragment[],
  sessionFilters: SqlFragment[]
): SqlFragment {
  const params: unknown[] = [];
  const rowWhere = ["1 = 1", scope.sql, ...rowFilters.map((f) => f.sql)].join(" AND ");
  const sessionWhere = ["1 = 1", ...sessionFilters.map((f) => f.sql)].join(" AND ");

  for (const cte of extraCtes) {
    params.push(...cte.params);
  }
  params.push(...scope.params);
  for (const f of rowFilters) {
    params.push(...f.params);
  }
  for (const f of sessionFilters) {
    params.push(...f.params);
  }

  const extraSql = extraCtes.length > 0 ? `${extraCtes.map((c) => c.sql).join(", ")}, ` : "";
  const sql = `WITH ${extraSql}session_rollup AS (
    SELECT ${buildRollupSelect()}
    FROM payments
    WHERE ${rowWhere}
    GROUP BY session_key, merchant_key, category_id, category_title
  ),
  sessions AS (
    SELECT
      session_rollup.*,
      CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END AS retry_count
    FROM session_rollup
    WHERE ${sessionWhere}
  )`;

  return { sql, params };
}

function merchantNameSelect(alias: string): string {
  return hasPaymentColumn("merchant_name") ? `MAX(${alias}.merchant_name) AS merchant_name` : "";
}

interface MerchantStatsResult {
  statsSql: string;
  params: unknown[];
  hasName: boolean;
}

/**
 * Merchant-level statistics over the sessions CTE, including last-7d windows
 * relative to the resolved window end. `signalFilters` (min failed value etc.)
 * are applied after aggregation so category medians are computed over the same
 * peer set the caller sees.
 */
function buildMerchantStats(sessionsCte: SqlFragment, signalFilters: SqlFragment[], windowEnd: string | number | null): MerchantStatsResult {
  const params = [...sessionsCte.params];
  const nameSelect = merchantNameSelect("sessions");

  const last7dStart = windowEnd === null ? null : subtractDays(windowEnd, 7);
  const prev7dStart = windowEnd === null ? null : subtractDays(windowEnd, 14);
  const numericMode = createdAtModeValue() === "number";
  const ge = numericMode ? "CAST(created_at AS REAL) >= ?" : "created_at >= ?";
  const lt = numericMode ? "CAST(created_at AS REAL) < ?" : "created_at < ?";

  const statsCtes: string[] = [];
  if (last7dStart !== null && prev7dStart !== null) {
    params.push(last7dStart, prev7dStart, last7dStart);
  }

  statsCtes.push(`merchant_stats AS (
    SELECT
      merchant_key,
      MAX(category_id) AS category_id,
      MAX(category_title) AS category_title,
      ${nameSelect ? `${nameSelect},` : ""}
      COUNT(*) AS sessions,
      SUM(CASE WHEN session_status = 'Failed' THEN 1 ELSE 0 END) AS failed_sessions,
      ROUND(
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE MIN(100.0, 100.0 * SUM(CASE WHEN session_status = 'Failed' THEN 1 ELSE 0 END) / COUNT(*))
        END,
        2
      ) AS failed_session_rate,
      ROUND(COALESCE(SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END), 0), 0) AS failed_value,
      SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) AS retry_sessions,
      ROUND(
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE MIN(100.0, 100.0 * SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) / COUNT(*))
        END,
        2
      ) AS retry_sessions_share,
      ROUND(COALESCE(SUM(CASE WHEN retry_count > 0 AND session_status = 'Failed' THEN amount ELSE 0 END), 0), 0) AS retry_loss_value,
      SUM(CASE WHEN verify_type = 'Automated' THEN 1 ELSE 0 END) AS automated_sessions,
      SUM(CASE WHEN verify_type = 'Manual' THEN 1 ELSE 0 END) AS manual_sessions,
      ROUND(
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE MIN(100.0, 100.0 * SUM(CASE WHEN verify_type = 'Automated' THEN 1 ELSE 0 END) / COUNT(*))
        END,
        2
      ) AS automated_share,
      ROUND(COALESCE(SUM(amount), 0), 0) AS total_value${
        last7dStart !== null && prev7dStart !== null
          ? `,
      ROUND(COALESCE(SUM(CASE WHEN session_status = 'Failed' AND ${ge} THEN amount ELSE 0 END), 0), 0) AS last_7d_failed_value,
      ROUND(COALESCE(SUM(CASE WHEN session_status = 'Failed' AND ${ge} AND ${lt} THEN amount ELSE 0 END), 0), 0) AS prev_7d_failed_value`
          : `,
      NULL AS last_7d_failed_value,
      NULL AS prev_7d_failed_value`
      }
    FROM sessions
    WHERE merchant_key IS NOT NULL
    GROUP BY merchant_key
  )`);

  if (signalFilters.length > 0) {
    const filterSql = signalFilters.map((f) => f.sql).join(" AND ");
    for (const f of signalFilters) {
      params.push(...f.params);
    }
    statsCtes.push(`filtered_stats AS (
      SELECT merchant_stats.*
      FROM merchant_stats
      WHERE ${filterSql}
    )`);
  }

  statsCtes.push(`category_median AS (
    SELECT
      category_id,
      ROUND(AVG(failed_session_rate), 2) AS median_failed_session_rate
    FROM (
      SELECT
        category_id,
        failed_session_rate,
        ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY failed_session_rate, merchant_key) AS rn,
        COUNT(*) OVER (PARTITION BY category_id) AS cnt
      FROM ${signalFilters.length > 0 ? "filtered_stats" : "merchant_stats"}
    )
    WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)
    GROUP BY category_id
  )`);

  statsCtes.push(`ranked AS (
    SELECT
      ${signalFilters.length > 0 ? "filtered_stats" : "merchant_stats"}.*,
      category_median.median_failed_session_rate AS category_median_failed_session_rate,
      ROUND(
        ${signalFilters.length > 0 ? "filtered_stats" : "merchant_stats"}.failed_session_rate
          - category_median.median_failed_session_rate,
        2
      ) AS category_delta,
      ROUND(PERCENT_RANK() OVER (ORDER BY ${signalFilters.length > 0 ? "filtered_stats" : "merchant_stats"}.failed_value), 4) AS failed_value_rank
    FROM ${signalFilters.length > 0 ? "filtered_stats" : "merchant_stats"}
    LEFT JOIN category_median ON category_median.category_id = ${signalFilters.length > 0 ? "filtered_stats" : "merchant_stats"}.category_id
  )`);

  return {
    statsSql: `${sessionsCte.sql}, ${statsCtes.join(", ")}`,
    params,
    hasName: nameSelect !== "",
  };
}

interface MerchantStatsRow {
  merchant_key: string;
  merchant_name: string | null;
  category_id: string | null;
  category_title: string | null;
  sessions: number;
  failed_sessions: number;
  failed_session_rate: number;
  failed_value: number;
  retry_sessions: number;
  retry_sessions_share: number;
  retry_loss_value: number;
  automated_sessions: number;
  manual_sessions: number;
  automated_share: number;
  total_value: number;
  last_7d_failed_value: number | null;
  prev_7d_failed_value: number | null;
  category_median_failed_session_rate: number | null;
  category_delta: number | null;
  failed_value_rank: number | null;
}

// ---------------------------------------------------------------------------
// GET /api/merchants
// ---------------------------------------------------------------------------

export interface MerchantListQuery {
  start: string | null;
  end: string | null;
  category: string | null;
  verification: "Automated" | "Manual" | null;
  psp: string | null;
  terminal: string | null;
  min_amount: number | null;
  max_amount: number | null;
  min_failed_value: number | null;
  min_retry_loss_value: number | null;
  min_retry_share: number | null;
}

function merchantEvidenceLinks(merchantKey: string): Record<string, EvidenceLink> {
  const key = encodeURIComponent(merchantKey);
  const base = `/api/merchant/${key}/sessions`;
  return {
    summary: {
      label: "Merchant summary",
      href: `/api/merchant/${key}/summary`,
    },
    sessions: {
      label: "All sessions",
      href: `${base}?sort=failed_value:desc,amount:desc`,
    },
    failed_value: {
      label: "Failed sessions",
      href: `${base}?status=Failed&sort=failed_value:desc,amount:desc`,
    },
    retry_loss_value: {
      label: "Retry-loss sessions",
      href: `${base}?status=Failed&retry=true&sort=failed_value:desc,amount:desc`,
    },
  };
}

function merchantPriority(row: MerchantStatsRow): { reasons: string[]; why: string } {
  const reasons: string[] = [];
  const parts: string[] = [];
  const { failedValueTopQuantile, retryLossShareOfFailed, failureRateDeltaPp, automatedShareMin } = PRIORITY_THRESHOLDS;

  const failedValueHigh =
    row.failed_value > 0 &&
    row.failed_value_rank !== null &&
    row.failed_value_rank >= failedValueTopQuantile;
  if (failedValueHigh) {
    reasons.push("Failed value high");
    parts.push(`top failed value (${row.failed_value.toLocaleString("en-US")} IRR)`);
  }

  const retryLossHeavy =
    row.retry_loss_value > 0 &&
    row.failed_value > 0 &&
    row.retry_loss_value / row.failed_value >= retryLossShareOfFailed;
  if (retryLossHeavy) {
    reasons.push("Retry-loss heavy");
    parts.push(
      `retry-loss ${Math.round((100 * row.retry_loss_value) / row.failed_value)}% of failed value`
    );
  }

  const categoryDelta = row.category_delta;
  if (categoryDelta !== null && categoryDelta >= failureRateDeltaPp) {
    reasons.push("High failure rate vs category");
    parts.push(`failure rate +${categoryDelta.toFixed(1)}pp vs category median`);
  }

  const automatedHeavy =
    row.automated_share >= automatedShareMin * 100 &&
    row.category_median_failed_session_rate !== null &&
    row.failed_session_rate > row.category_median_failed_session_rate;
  if (automatedHeavy) {
    reasons.push("High Automated share");
    parts.push(`flow is ${row.automated_share.toFixed(0)}% Automated with above-median failure rate`);
  }

  const why =
    parts.length > 0
      ? `Prioritized: ${parts.join("; ")}.`
      : "No material priority signal within the current filter scope.";

  return { reasons, why };
}

function toMerchantListRow(row: MerchantStatsRow): MerchantListRow {
  const { reasons, why } = merchantPriority(row);
  const last7d = row.last_7d_failed_value ?? 0;
  const prev7d = row.prev_7d_failed_value ?? 0;
  const last7dChange =
    prev7d > 0 ? Math.round(((last7d - prev7d) / prev7d) * 10000) / 100 : null;

  return {
    merchant_key: row.merchant_key,
    merchant_name: row.merchant_name ?? null,
    category_id: row.category_id ?? null,
    category_title: row.category_title ?? null,
    sessions: row.sessions,
    failed_sessions: row.failed_sessions,
    failed_session_rate: row.failed_session_rate,
    failed_value: row.failed_value,
    retry_sessions: row.retry_sessions,
    retry_sessions_share: row.retry_sessions_share,
    retry_loss_value: row.retry_loss_value,
    automated_sessions: row.automated_sessions,
    manual_sessions: row.manual_sessions,
    automated_share: row.automated_share,
    total_value: row.total_value,
    category_median_failed_session_rate: row.category_median_failed_session_rate ?? null,
    category_delta: row.category_delta ?? null,
    last_7d_failed_value: last7d,
    last_7d_change: last7dChange,
    failed_value_rank: row.failed_value_rank ?? null,
    priority_reasons: reasons,
    why_prioritized: why,
    evidence_links: merchantEvidenceLinks(row.merchant_key),
  };
}

export interface MerchantListResult {
  rows: MerchantListRow[];
  total: number;
}

export function queryMerchants(query: MerchantListQuery, sort: SortSpec[], page: number, pageSize: number): MerchantListResult {
  const db = getDatabase();
  const rowFilters: SqlFragment[] = [];
  const sessionFilters: SqlFragment[] = [];
  const signalFilters: SqlFragment[] = [];
  const extraCtes: SqlFragment[] = [];

  if (query.start) {
    rowFilters.push(createdAtBound(">=", query.start));
  }
  if (query.end) {
    rowFilters.push(createdAtBound("<=", query.end));
  }
  if (query.category) {
    rowFilters.push(frag("(category_id = ? OR category_title = ?)", query.category, query.category));
  }
  if (query.verification) {
    rowFilters.push(frag("verify_type = ?", query.verification));
  }
  if (query.psp !== null) {
    const pspCol = pickPaymentColumn(PSP_COLUMNS);
    if (!pspCol) {
      throw new DataColumnError("psp", "The dataset does not expose a PSP column; the psp filter is unavailable.");
    }
    extraCtes.push(
      frag(
        `psp_sessions AS (SELECT DISTINCT session_key FROM payments WHERE ${pspCol} = ?)`,
        query.psp
      )
    );
    rowFilters.push(frag("session_key IN (SELECT session_key FROM psp_sessions)"));
  }
  if (query.terminal !== null) {
    const terminalCol = pickPaymentColumn(TERMINAL_COLUMNS);
    if (!terminalCol) {
      throw new DataColumnError(
        "terminal",
        "The dataset does not expose a terminal column; the terminal filter is unavailable."
      );
    }
    extraCtes.push(
      frag(
        `terminal_sessions AS (SELECT DISTINCT session_key FROM payments WHERE ${terminalCol} = ?)`,
        query.terminal
      )
    );
    rowFilters.push(frag("session_key IN (SELECT session_key FROM terminal_sessions)"));
  }
  if (query.min_amount !== null) {
    sessionFilters.push(frag("amount >= ?", query.min_amount));
  }
  if (query.max_amount !== null) {
    sessionFilters.push(frag("amount <= ?", query.max_amount));
  }
  if (query.min_failed_value !== null) {
    signalFilters.push(frag("failed_value >= ?", query.min_failed_value));
  }
  if (query.min_retry_loss_value !== null) {
    signalFilters.push(frag("retry_loss_value >= ?", query.min_retry_loss_value));
  }
  if (query.min_retry_share !== null) {
    signalFilters.push(frag("retry_sessions_share >= ?", query.min_retry_share));
  }

  const windowEnd = resolveWindowEnd(query.end);
  const stats = buildMerchantStats(buildSessionsCte(extraCtes, frag("1 = 1"), rowFilters, sessionFilters), signalFilters, windowEnd);

  const orderBySql = sort
    .map((s) => `${MERCHANT_SORT_FIELDS[s.field]} ${s.direction.toUpperCase()}`)
    .join(", ");

  const pageSql = `${stats.statsSql}
  SELECT
    ranked.*
  FROM ranked
  ORDER BY ${orderBySql}, merchant_key ASC
  LIMIT ? OFFSET ?`;

  const countSql = `${stats.statsSql}
  SELECT COUNT(*) AS total
  FROM ranked`;

  const rows = db.prepare(pageSql).all(...stats.params, pageSize, (page - 1) * pageSize) as MerchantStatsRow[];
  const totalRow = db.prepare(countSql).get(...stats.params) as { total: number } | undefined;

  return {
    rows: rows.map(toMerchantListRow),
    total: totalRow?.total ?? 0,
  };
}

// ---------------------------------------------------------------------------
// GET /api/merchant/:merchant_key/summary
// ---------------------------------------------------------------------------

export interface MerchantSummaryResult {
  merchant: MerchantSummaryResponse["merchant"];
  metrics: MerchantSummaryResponse["metrics"];
  outcomeMix: OutcomeMixEntry[];
  otherSessions: number;
  verificationModes: VerificationModeRow[];
  pspClusters: ClusterRow[];
  terminalClusters: ClusterRow[];
  topFailedSessions: EvidenceSessionRef[];
  topRetryLossSessions: EvidenceSessionRef[];
  evidenceLinks: Record<string, EvidenceLink>;
}

function merchantMeta(merchantKey: string): { merchant_key: string; merchant_name: string | null; category_id: string | null; category_title: string | null } {
  const db = getDatabase();
  const nameCol = pickPaymentColumn(["merchant_name"]);
  const row = db
    .prepare(
      `SELECT
         MAX(category_id) AS category_id,
         MAX(category_title) AS category_title${nameCol ? `, MAX(${nameCol}) AS merchant_name` : ""}
       FROM payments
       WHERE merchant_key = ?`
    )
    .get(merchantKey) as { category_id: string | null; category_title: string | null; merchant_name?: string | null } | undefined;

  return {
    merchant_key: merchantKey,
    merchant_name: row?.merchant_name ?? null,
    category_id: row?.category_id ?? null,
    category_title: row?.category_title ?? null,
  };
}

export function getMerchantSummary(merchantKey: string): MerchantSummaryResult | null {
  const db = getDatabase();

  const exists = db.prepare("SELECT 1 AS one FROM payments WHERE merchant_key = ? LIMIT 1").get(merchantKey);
  if (!exists) {
    return null;
  }

  // Merchant stats + category benchmark. The summary endpoint has no filter
  // scope, so the category median is computed over ALL merchants (peers =
  // whole dataset, per OpenSpec/05) and the merchant's own row is picked from
  // the same single pass over the session rollup.
  const stats = buildMerchantStats(buildSessionsCte([], frag("1 = 1"), [], []), [], null);
  const statsRow = (
    db.prepare(`${stats.statsSql} SELECT ranked.* FROM ranked`).all(...stats.params) as MerchantStatsRow[]
  ).find((row) => row.merchant_key === merchantKey) ?? null;

  const outcomeRows = db
    .prepare(
      `WITH session_rollup AS (
        SELECT ${ROLLUP_SELECT}
        FROM payments
        WHERE merchant_key = ?
        GROUP BY session_key, merchant_key, category_id, category_title
      )
      SELECT session_status, COUNT(*) AS sessions
      FROM session_rollup
      GROUP BY session_status`
    )
    .all(merchantKey) as Array<{ session_status: SessionStatus | null; sessions: number }>;

  const modeRows = db
    .prepare(
      `WITH session_rollup AS (
        SELECT ${ROLLUP_SELECT}
        FROM payments
        WHERE merchant_key = ?
        GROUP BY session_key, merchant_key, category_id, category_title
      ),
      sessions AS (
        SELECT
          session_rollup.*,
          CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END AS retry_count
        FROM session_rollup
      )
      SELECT
        verify_type,
        COUNT(*) AS sessions,
        SUM(CASE WHEN session_status = 'Failed' THEN 1 ELSE 0 END) AS failed_sessions,
        ROUND(
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE MIN(100.0, 100.0 * SUM(CASE WHEN session_status = 'Failed' THEN 1 ELSE 0 END) / COUNT(*))
          END,
          2
        ) AS failed_session_rate,
        SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) AS retry_sessions,
        ROUND(COALESCE(SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END), 0), 0) AS failed_value,
        ROUND(COALESCE(SUM(CASE WHEN retry_count > 0 AND session_status = 'Failed' THEN amount ELSE 0 END), 0), 0) AS retry_loss_value
      FROM sessions
      WHERE verify_type IN ('Automated', 'Manual')
      GROUP BY verify_type
      ORDER BY verify_type`
    )
    .all(merchantKey) as Array<{
    verify_type: "Automated" | "Manual";
    sessions: number;
    failed_sessions: number;
    failed_session_rate: number;
    retry_sessions: number;
    failed_value: number;
    retry_loss_value: number;
  }>;

  const evidenceRows = db
    .prepare(
      `WITH session_rollup AS (
        SELECT ${ROLLUP_SELECT}
        FROM payments
        WHERE merchant_key = ?
        GROUP BY session_key, merchant_key, category_id, category_title
      ),
      sessions AS (
        SELECT
          session_rollup.*,
          CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END AS retry_count
        FROM session_rollup
      )
      SELECT session_key, amount, session_status, retry_count
      FROM sessions
      WHERE session_status = 'Failed'
      ORDER BY amount DESC, session_key ASC
      LIMIT 5`
    )
    .all(merchantKey) as EvidenceSessionRef[];

  const retryLossRows = db
    .prepare(
      `WITH session_rollup AS (
        SELECT ${ROLLUP_SELECT}
        FROM payments
        WHERE merchant_key = ?
        GROUP BY session_key, merchant_key, category_id, category_title
      ),
      sessions AS (
        SELECT
          session_rollup.*,
          CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END AS retry_count
        FROM session_rollup
      )
      SELECT session_key, amount, session_status, retry_count
      FROM sessions
      WHERE retry_count > 0 AND session_status = 'Failed'
      ORDER BY amount DESC, session_key ASC
      LIMIT 5`
    )
    .all(merchantKey) as EvidenceSessionRef[];

  // PSP / terminal risk clusters (only when the dataset exposes the columns).
  const pspCol = pickPaymentColumn(PSP_COLUMNS);
  const terminalCol = pickPaymentColumn(TERMINAL_COLUMNS);
  const pspClusters = pspCol ? queryClusters(merchantKey, pspCol) : [];
  const terminalClusters = terminalCol ? queryClusters(merchantKey, terminalCol) : [];

  const key = encodeURIComponent(merchantKey);
  const base = `/api/merchant/${key}/sessions`;
  const evidenceLinks: Record<string, EvidenceLink> = {
    sessions: { label: "All sessions", href: `${base}?sort=failed_value:desc,amount:desc` },
    failed_value: { label: "Failed sessions", href: `${base}?status=Failed&sort=failed_value:desc,amount:desc` },
    retry_loss_value: {
      label: "Retry-loss sessions",
      href: `${base}?status=Failed&retry=true&sort=failed_value:desc,amount:desc`,
    },
  };

  const meta = merchantMeta(merchantKey);

  const outcomeMix: OutcomeMixEntry[] = CANONICAL_STATUSES.map((status) => ({
    status,
    sessions: outcomeRows.find((row) => row.session_status === status)?.sessions ?? 0,
  }));
  const otherSessions = outcomeRows
    .filter((row) => row.session_status === null || !CANONICAL_STATUSES.includes(row.session_status))
    .reduce((sum, row) => sum + row.sessions, 0);

  const totalSessions = outcomeRows.reduce((sum, row) => sum + row.sessions, 0);
  const failedSessions = outcomeMix.find((entry) => entry.status === "Failed")?.sessions ?? 0;
  const retrySessions =
    statsRow?.retry_sessions ?? 0;
  const metrics: MerchantSummaryResponse["metrics"] = {
    sessions: totalSessions,
    failed_sessions: failedSessions,
    failed_session_rate: statsRow?.failed_session_rate ?? 0,
    failed_value: statsRow?.failed_value ?? 0,
    retry_sessions: retrySessions,
    retry_session_rate:
      totalSessions > 0 ? Math.round((10000 * retrySessions) / totalSessions) / 100 : 0,
    retry_loss_value: statsRow?.retry_loss_value ?? 0,
    automated_sessions: statsRow?.automated_sessions ?? 0,
    manual_sessions: statsRow?.manual_sessions ?? 0,
    automated_share: statsRow?.automated_share ?? 0,
    total_value: statsRow?.total_value ?? 0,
    category_median_failed_session_rate: statsRow?.category_median_failed_session_rate ?? null,
    category_delta: statsRow?.category_delta ?? null,
  };

  return {
    merchant: meta,
    metrics,
    outcomeMix,
    otherSessions,
    verificationModes: modeRows.map((row) => ({
      verify_type: row.verify_type,
      sessions: row.sessions,
      failed_sessions: row.failed_sessions,
      failed_session_rate: row.failed_session_rate,
      retry_sessions: row.retry_sessions,
      failed_value: row.failed_value,
      retry_loss_value: row.retry_loss_value,
    })),
    pspClusters,
    terminalClusters,
    topFailedSessions: evidenceRows,
    topRetryLossSessions: retryLossRows,
    evidenceLinks,
  };
}

function queryClusters(merchantKey: string, column: string): ClusterRow[] {
  const db = getDatabase();
  return db
    .prepare(
      `WITH session_rollup AS (
        SELECT ${ROLLUP_SELECT}
        FROM payments
        WHERE merchant_key = ?
        GROUP BY session_key, merchant_key, category_id, category_title
      ),
      sessions AS (
        SELECT
          session_rollup.*,
          CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END AS retry_count
        FROM session_rollup
      ),
      cluster_sessions AS (
        SELECT DISTINCT session_key, ${column} AS cluster_key
        FROM payments
        WHERE merchant_key = ? AND ${column} IS NOT NULL
      )
      SELECT
        cluster_sessions.cluster_key AS key,
        COUNT(*) AS sessions,
        ROUND(
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE MIN(100.0, 100.0 * SUM(CASE WHEN sessions.session_status = 'Failed' THEN 1 ELSE 0 END) / COUNT(*))
          END,
          2
        ) AS failed_session_rate,
        ROUND(
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE MIN(100.0, 100.0 * SUM(CASE WHEN sessions.retry_count > 0 THEN 1 ELSE 0 END) / COUNT(*))
          END,
          2
        ) AS retry_rate,
        ROUND(COALESCE(SUM(CASE WHEN sessions.session_status = 'Failed' THEN sessions.amount ELSE 0 END), 0), 0) AS failed_value,
        ROUND(COALESCE(SUM(CASE WHEN sessions.retry_count > 0 AND sessions.session_status = 'Failed' THEN sessions.amount ELSE 0 END), 0), 0) AS retry_loss_value
      FROM cluster_sessions
      JOIN sessions ON sessions.session_key = cluster_sessions.session_key
      GROUP BY cluster_sessions.cluster_key
      ORDER BY failed_value DESC, sessions DESC, cluster_sessions.cluster_key ASC
      LIMIT 25`
    )
    .all(merchantKey, merchantKey) as ClusterRow[];
}

// ---------------------------------------------------------------------------
// GET /api/merchant/:merchant_key/sessions
// ---------------------------------------------------------------------------

export interface MerchantSessionsQuery {
  start: string | null;
  end: string | null;
  status: SessionStatus[] | null;
  retry: boolean | null;
  verification: "Automated" | "Manual" | null;
  min_amount: number | null;
  max_amount: number | null;
}

export interface MerchantSessionsResult {
  merchant: MerchantSessionsResponse["merchant"];
  rows: MerchantSessionRow[];
  total: number;
}

export function queryMerchantSessions(
  merchantKey: string,
  query: MerchantSessionsQuery,
  sort: SortSpec[],
  page: number,
  pageSize: number
): MerchantSessionsResult | null {
  const db = getDatabase();

  const exists = db.prepare("SELECT 1 AS one FROM payments WHERE merchant_key = ? LIMIT 1").get(merchantKey);
  if (!exists) {
    return null;
  }

  const rowFilters: SqlFragment[] = [];
  const sessionFilters: SqlFragment[] = [];
  if (query.start) {
    rowFilters.push(createdAtBound(">=", query.start));
  }
  if (query.end) {
    rowFilters.push(createdAtBound("<=", query.end));
  }
  if (query.status) {
    sessionFilters.push(frag(`session_status IN (${query.status.map(() => "?").join(", ")})`, ...query.status));
  }
  if (query.retry === true) {
    sessionFilters.push(frag("retry_count > 0"));
  }
  if (query.retry === false) {
    sessionFilters.push(frag("retry_count = 0"));
  }
  if (query.verification) {
    sessionFilters.push(frag("verify_type = ?", query.verification));
  }
  if (query.min_amount !== null) {
    sessionFilters.push(frag("amount >= ?", query.min_amount));
  }
  if (query.max_amount !== null) {
    sessionFilters.push(frag("amount <= ?", query.max_amount));
  }

  const sessionsCte = buildSessionsCte([], frag("merchant_key = ?", merchantKey), rowFilters, sessionFilters);
  const params = [...sessionsCte.params];

  const responseCodeCol = pickPaymentColumn(RESPONSE_CODE_COLUMNS);
  const joinSql = responseCodeCol
    ? `
  LEFT JOIN payments last_attempt
    ON last_attempt.session_key = sessions.session_key
   AND last_attempt.try_seq = sessions.try_seq_last
   AND last_attempt.merchant_key = sessions.merchant_key`
    : "";
  const selectList = `
    sessions.session_key,
    sessions.session_status,
    sessions.amount,
    sessions.attempt_count,
    sessions.retry_count,
    sessions.try_seq_last,
    sessions.created_at,
    sessions.first_try_created_at,
    sessions.last_try_created_at,
    sessions.verify_type${responseCodeCol ? `,\n    last_attempt.${responseCodeCol} AS last_try_response_code` : ""}`;

  const orderBySql = sort
    .map((s) => `${SESSION_SORT_FIELDS[s.field]} ${s.direction.toUpperCase()}`)
    .join(", ");

  const pageSql = `${sessionsCte.sql}, joined AS (
    SELECT ${selectList}
    FROM sessions
    ${joinSql}
  )
  SELECT joined.*
  FROM joined
  ORDER BY ${orderBySql}, session_key ASC
  LIMIT ? OFFSET ?`;

  const countSql = `${sessionsCte.sql}
  SELECT COUNT(*) AS total
  FROM sessions`;

  const rows = db.prepare(pageSql).all(...params, pageSize, (page - 1) * pageSize) as MerchantSessionRow[];
  const totalRow = db.prepare(countSql).get(...params) as { total: number } | undefined;

  return {
    merchant: merchantMeta(merchantKey),
    rows: rows.map((row) => ({
      ...row,
      last_try_response_code: responseCodeCol ? row.last_try_response_code : null,
      reason: sessionReason(row),
    })),
    total: totalRow?.total ?? 0,
  };
}

function sessionReason(row: MerchantSessionRow): string | null {
  switch (row.session_status) {
    case "Failed":
      return row.retry_count > 0 ? "retry-loss, final failure" : "final failure";
    case "Paid":
      return "paid, pending verification";
    case "Verified":
      return "verified";
    case "Reversed":
      return "reversed";
    case "NoAttempt":
      return "no attempt";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/session/:session_key
// ---------------------------------------------------------------------------

export interface SessionDetailResult {
  session: SessionDetailResponse["session"];
  attempts: SessionDetailResponse["attempts"];
  summary: string;
}

export function getSessionDetail(sessionKey: string): SessionDetailResult | null {
  const db = getDatabase();

  const exists = db.prepare("SELECT 1 AS one FROM payments WHERE session_key = ? LIMIT 1").get(sessionKey);
  if (!exists) {
    return null;
  }

  const verifiedAtCol = pickPaymentColumn(["verified_at"]);
  const settledAtCol = pickPaymentColumn(["settled_at"]);
  const extraSelects = [
    verifiedAtCol ? `MAX(${verifiedAtCol}) AS verified_at` : "",
    settledAtCol ? `MAX(${settledAtCol}) AS settled_at` : "",
  ]
    .filter(Boolean)
    .join(",\n    ");

  const sessionRow = db
    .prepare(
      `WITH session_rollup AS (
        SELECT
          session_key,
          merchant_key,
          category_id,
          category_title,
          MAX(amount) AS amount,
          MAX(session_status) AS session_status,
          MAX(created_at) AS created_at,
          MIN(CASE WHEN try_seq > 0 THEN try_created_at END) AS first_try_created_at,
          MAX(CASE WHEN try_seq > 0 THEN try_created_at END) AS last_try_created_at,
          MAX(try_seq) AS try_seq_last,
          COUNT(CASE WHEN try_seq > 0 THEN 1 END) AS attempt_count,
          MAX(verify_type) AS verify_type${extraSelects ? `,\n        ${extraSelects}` : ""}
        FROM payments
        WHERE session_key = ?
        GROUP BY session_key, merchant_key, category_id, category_title
      )
      SELECT
        session_rollup.*,
        CASE WHEN attempt_count > 1 THEN attempt_count - 1 ELSE 0 END AS retry_count
      FROM session_rollup`
    )
    .get(sessionKey) as SessionDetailResponse["session"] | undefined;

  if (!sessionRow) {
    return null;
  }
  // Keep the response shape stable even when the dataset lacks these columns.
  if (!verifiedAtCol) {
    sessionRow.verified_at = null;
  }
  if (!settledAtCol) {
    sessionRow.settled_at = null;
  }

  const rawAttempts = db
    .prepare("SELECT * FROM payments WHERE session_key = ? ORDER BY try_seq ASC")
    .all(sessionKey) as Array<Record<string, unknown>>;

  const responseCodeCol = pickPaymentColumn(RESPONSE_CODE_COLUMNS);
  const pspCol = pickPaymentColumn(PSP_COLUMNS);
  const terminalCol = pickPaymentColumn(TERMINAL_COLUMNS);
  const issuerBankCol = pickPaymentColumn(ISSUER_BANK_COLUMNS);

  const attempts = rawAttempts.map((raw, index) => {
    const trySeq = Number(raw.try_seq ?? 0);
    return {
      try_seq: trySeq,
      try_created_at: (raw.try_created_at as string | null) ?? null,
      try_status: (raw.try_status as string | null) ?? null,
      amount: raw.amount == null ? null : Number(raw.amount),
      verify_type: (raw.verify_type as string | null) ?? null,
      session_status: (raw.session_status as string | null) ?? null,
      created_at: (raw.created_at as string | null) ?? null,
      try_response_code: responseCodeCol ? ((raw[responseCodeCol] as string | number | null) ?? null) : null,
      psp: pspCol ? ((raw[pspCol] as string | null) ?? null) : null,
      terminal: terminalCol ? ((raw[terminalCol] as string | null) ?? null) : null,
      issuer_bank: issuerBankCol ? ((raw[issuerBankCol] as string | null) ?? null) : null,
      is_last_attempt: index === rawAttempts.length - 1,
      raw,
    };
  });

  const summary = buildSessionSummary(sessionRow, attempts);

  return { session: sessionRow, attempts, summary };
}

function buildSessionSummary(
  session: SessionDetailResponse["session"],
  attempts: SessionDetailResponse["attempts"]
): string {
  const attemptCount = session.attempt_count ?? 0;
  if (attemptCount === 0) {
    return `Session ${session.session_key} has no payment attempts (${session.session_status ?? "NoAttempt"}).`;
  }

  const last = attempts[attempts.length - 1];
  const statusLine = `Session ${session.session_key} ended in ${session.session_status ?? "Unknown"} after ${attemptCount} attempt${attemptCount === 1 ? "" : "s"}`;
  const detailParts: string[] = [];
  if (last && last.try_status) {
    detailParts.push(`last attempt status ${last.try_status}`);
  }
  if (last && last.try_response_code !== null && last.try_response_code !== undefined && last.try_response_code !== "") {
    detailParts.push(`last attempt response code ${last.try_response_code}`);
  }
  if (attempts.length > 1) {
    detailParts.push(`${session.retry_count ?? 0} retr${(session.retry_count ?? 0) === 1 ? "y" : "ies"}`);
  }
  return detailParts.length > 0 ? `${statusLine}; ${detailParts.join(", ")}.` : `${statusLine}.`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a requested filter references a column the dataset lacks. */
export class DataColumnError extends Error {
  constructor(
    public param: string,
    message: string
  ) {
    super(message);
    this.name = "DataColumnError";
  }
}
