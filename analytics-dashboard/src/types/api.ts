/**
 * Public API response/request types for the analytics-dashboard API layer.
 *
 * Field naming follows the OpenSpec data dictionary (snake_case), matching
 * `src/types/domain.ts`. All money values are IRR. All rates are percentages
 * bounded to 0..100 (see OpenSpec/02 grain rules).
 */

import type { SessionStatus } from "@/types/domain";

// ---------------------------------------------------------------------------
// Shared envelopes
// ---------------------------------------------------------------------------

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  field: string;
  direction: SortDirection;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface ApiErrorDetails {
  /** Query-parameter key that failed validation, when applicable. */
  param?: string;
  /** Accepted values for the parameter, when applicable. */
  allowed?: string[];
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetails;
  };
}

/** Relative API path the UI can call to fetch the composing sessions. */
export interface EvidenceLink {
  label: string;
  href: string;
}

// ---------------------------------------------------------------------------
// GET /api/merchants
// ---------------------------------------------------------------------------

export interface MerchantListRow {
  merchant_key: string;
  merchant_name: string | null;
  category_id: string | null;
  category_title: string | null;
  /** Total sessions (session grain). */
  sessions: number;
  /** Sessions whose final session_status is Failed. */
  failed_sessions: number;
  /** failed_sessions / sessions, percent, 0..100, 2 decimals. */
  failed_session_rate: number;
  /** Session-grain sum of amount for sessions with final status Failed. */
  failed_value: number;
  /** Sessions with retry_count > 0. */
  retry_sessions: number;
  /** retry_sessions / sessions, percent, 0..100, 2 decimals. */
  retry_sessions_share: number;
  /** Session-grain sum of amount for retry sessions ending in final failure. */
  retry_loss_value: number;
  automated_sessions: number;
  manual_sessions: number;
  /** Automated sessions share, percent, 0..100. */
  automated_share: number;
  /** Session-grain sum of amount across all sessions. */
  total_value: number;
  /** Median failed_session_rate of peer merchants in the same category. */
  category_median_failed_session_rate: number | null;
  /** failed_session_rate - category median (percentage points). */
  category_delta: number | null;
  /** Failed value in the last 7 days of the window. */
  last_7d_failed_value: number;
  /** % change of failed value vs the previous 7 days (null when undefined). */
  last_7d_change: number | null;
  /** Percentile rank of failed_value within the filtered merchant set (0..1). */
  failed_value_rank: number | null;
  /** Deterministic priority signals (see OpenSpec/03). */
  priority_reasons: string[];
  /** Concise traceable sentence built from the priority signals. */
  why_prioritized: string;
  /** Query links to fetch the sessions composing each aggregated metric. */
  evidence_links: Record<string, EvidenceLink>;
}

export interface MerchantListFilters {
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

export interface MerchantListResponse {
  merchants: MerchantListRow[];
  pagination: PaginationMeta;
  sort: SortSpec[];
  filters: MerchantListFilters;
}

// ---------------------------------------------------------------------------
// GET /api/merchant/:merchant_key/summary
// ---------------------------------------------------------------------------

export interface OutcomeMixEntry {
  status: SessionStatus;
  sessions: number;
}

export interface VerificationModeRow {
  verify_type: "Automated" | "Manual";
  sessions: number;
  failed_sessions: number;
  failed_session_rate: number;
  retry_sessions: number;
  failed_value: number;
  retry_loss_value: number;
}

export interface ClusterRow {
  key: string;
  sessions: number;
  failed_session_rate: number;
  retry_rate: number;
  failed_value: number;
  retry_loss_value: number;
}

export interface EvidenceSessionRef {
  session_key: string;
  amount: number | null;
  session_status: SessionStatus | null;
  retry_count: number;
}

export interface MerchantSummaryResponse {
  merchant: {
    merchant_key: string;
    merchant_name: string | null;
    category_id: string | null;
    category_title: string | null;
  };
  metrics: {
    sessions: number;
    failed_sessions: number;
    failed_session_rate: number;
    failed_value: number;
    retry_sessions: number;
    retry_session_rate: number;
    retry_loss_value: number;
    automated_sessions: number;
    manual_sessions: number;
    automated_share: number;
    total_value: number;
    category_median_failed_session_rate: number | null;
    category_delta: number | null;
  };
  outcome_mix: {
    entries: OutcomeMixEntry[];
    other_sessions: number;
  };
  verification_modes: VerificationModeRow[];
  /** Only present when the raw dataset exposes a PSP column. */
  psp_clusters: ClusterRow[];
  /** Only present when the raw dataset exposes a terminal column. */
  terminal_clusters: ClusterRow[];
  evidence: {
    links: Record<string, EvidenceLink>;
    /** Top composing sessions for the primary risk metrics. */
    top_failed_sessions: EvidenceSessionRef[];
    top_retry_loss_sessions: EvidenceSessionRef[];
  };
}

// ---------------------------------------------------------------------------
// GET /api/merchant/:merchant_key/sessions
// ---------------------------------------------------------------------------

export interface MerchantSessionRow {
  session_key: string;
  session_status: SessionStatus | null;
  amount: number | null;
  attempt_count: number;
  retry_count: number;
  try_seq_last: number | null;
  created_at: string | null;
  first_try_created_at: string | null;
  last_try_created_at: string | null;
  verify_type: string | null;
  /** Response code of the last attempt, when the dataset exposes one. */
  last_try_response_code: string | number | null;
  /** Short deterministic reason for prioritization (see OpenSpec/07). */
  reason: string | null;
}

export interface MerchantSessionsFilters {
  start: string | null;
  end: string | null;
  status: SessionStatus[] | null;
  retry: boolean | null;
  verification: "Automated" | "Manual" | null;
  min_amount: number | null;
  max_amount: number | null;
}

export interface MerchantSessionsResponse {
  merchant: {
    merchant_key: string;
    merchant_name: string | null;
    category_id: string | null;
    category_title: string | null;
  };
  sessions: MerchantSessionRow[];
  pagination: PaginationMeta;
  sort: SortSpec[];
  filters: MerchantSessionsFilters;
}

// ---------------------------------------------------------------------------
// GET /api/session/:session_key
// ---------------------------------------------------------------------------

export interface SessionAttempt {
  try_seq: number;
  try_created_at: string | null;
  try_status: string | null;
  amount: number | null;
  verify_type: string | null;
  session_status: string | null;
  created_at: string | null;
  /** Response code when the dataset exposes one. */
  try_response_code: string | number | null;
  /** PSP identifier when the dataset exposes one. */
  psp: string | null;
  /** Terminal identifier when the dataset exposes one. */
  terminal: string | null;
  /** Issuer bank code when the dataset exposes one. */
  issuer_bank: string | null;
  /** True when this attempt is the last one in the session. */
  is_last_attempt: boolean;
  /** Full original row, unmodified, for raw evidence panels. */
  raw: Record<string, unknown>;
}

export interface SessionDetailResponse {
  session: {
    session_key: string;
    merchant_key: string | null;
    category_id: string | null;
    category_title: string | null;
    amount: number | null;
    session_status: SessionStatus | null;
    created_at: string | null;
    first_try_created_at: string | null;
    last_try_created_at: string | null;
    verified_at: string | null;
    settled_at: string | null;
    attempt_count: number;
    retry_count: number;
    try_seq_last: number | null;
    verify_type: string | null;
  };
  attempts: SessionAttempt[];
  /** Deterministic one-line summary separating session vs attempt state. */
  summary: string;
}
