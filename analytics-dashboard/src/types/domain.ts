export type SessionStatus = "Verified" | "Paid" | "Failed" | "Reversed" | "NoAttempt" | "Unknown";
export type TryStatus = "Verified" | "Paid" | "Failed" | "Reversed" | "NoAttempt" | "Unknown";

export interface SessionAggregateRow {
  session_key: string;
  merchant_key: string | null;
  category_id: string | null;
  category_title: string | null;
  amount: number | null;
  session_status: SessionStatus | null;
  created_at: string | null;
  first_try_created_at: string | null;
  last_try_created_at: string | null;
  attempt_count: number;
  retry_count: number;
  verify_type: string | null;
}

export interface MerchantAggregateRow {
  merchant_key: string;
  sessions: number;
  fail_rate: number;
  failed_value: number;
}

export interface RetrySessionAggregateRow {
  session_key: string;
  merchant_key: string | null;
  amount: number | null;
  session_status: SessionStatus | null;
  attempt_count: number;
  retry_count: number;
}
