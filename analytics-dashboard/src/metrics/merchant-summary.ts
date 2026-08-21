import { db } from "@/data/db";

export function getMerchantPrioritySample() {
  return db
    .prepare(`
      SELECT merchant_key,
             COUNT(DISTINCT session_key) AS sessions,
             ROUND(100.0 * SUM(CASE WHEN session_status = 'Failed' THEN 1 ELSE 0 END) / COUNT(DISTINCT session_key), 2) AS fail_rate,
             ROUND(SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END), 0) AS failed_value
      FROM payments
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
