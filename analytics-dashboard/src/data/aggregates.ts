import { getDatabase } from "@/data/db";
import type { MerchantAggregateRow, RetrySessionAggregateRow, SessionAggregateRow } from "@/types/domain";

export const SESSION_AGGREGATE_SQL = `
  WITH session_rollup AS (
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
      MAX(try_seq) AS max_try_seq,
      COUNT(CASE WHEN try_seq > 0 THEN 1 END) AS attempt_count,
      MAX(verify_type) AS verify_type
    FROM payments
    GROUP BY session_key, merchant_key, category_id, category_title
  )
  SELECT
    session_key,
    merchant_key,
    category_id,
    category_title,
    amount,
    session_status,
    created_at,
    first_try_created_at,
    last_try_created_at,
    attempt_count,
    CASE
      WHEN attempt_count > 1 THEN attempt_count - 1
      ELSE 0
    END AS retry_count,
    verify_type
  FROM session_rollup
  ORDER BY session_key
`;

export const MERCHANT_AGGREGATE_SQL = `
  WITH session_rollup AS (
    SELECT
      merchant_key,
      session_key,
      MAX(session_status) AS session_status,
      MAX(amount) AS amount
    FROM payments
    GROUP BY merchant_key, session_key
  )
  SELECT
    merchant_key,
    COUNT(*) AS sessions,
    ROUND(
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE MIN(100.0, 100.0 * SUM(CASE WHEN session_status = 'Failed' THEN 1 ELSE 0 END) / COUNT(*))
      END,
      2
    ) AS fail_rate,
    ROUND(SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END), 0) AS failed_value
  FROM session_rollup
  GROUP BY merchant_key
  ORDER BY failed_value DESC
`;

export const RETRY_SESSION_AGGREGATE_SQL = `
  WITH session_rollup AS (
    SELECT
      session_key,
      merchant_key,
      MAX(amount) AS amount,
      MAX(session_status) AS session_status,
      COUNT(CASE WHEN try_seq > 0 THEN 1 END) AS attempt_count
    FROM payments
    GROUP BY session_key, merchant_key
  )
  SELECT
    session_key,
    merchant_key,
    amount,
    session_status,
    attempt_count,
    CASE
      WHEN attempt_count > 1 THEN attempt_count - 1
      ELSE 0
    END AS retry_count
  FROM session_rollup
  WHERE attempt_count > 1
  ORDER BY session_key
`;

export function getSessionAggregateRows(): SessionAggregateRow[] {
  return getDatabase()
    .prepare(SESSION_AGGREGATE_SQL)
    .all() as SessionAggregateRow[];
}

export function getMerchantAggregateRows(): MerchantAggregateRow[] {
  return getDatabase()
    .prepare(MERCHANT_AGGREGATE_SQL)
    .all() as MerchantAggregateRow[];
}

export function getRetrySessionAggregateRows(): RetrySessionAggregateRow[] {
  return getDatabase()
    .prepare(RETRY_SESSION_AGGREGATE_SQL)
    .all() as RetrySessionAggregateRow[];
}
