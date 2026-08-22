import { getDatabase } from "@/data/db";

export function getMerchantPrioritySample() {
  return getDatabase()
    .prepare(`
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
      LIMIT 10
    `)
    .all() as Array<{
      merchant_key: string;
      sessions: number;
      fail_rate: number;
      failed_value: number;
    }>;
}
