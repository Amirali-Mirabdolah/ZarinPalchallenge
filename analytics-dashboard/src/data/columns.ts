import { getDatabase } from "@/data/db";

/**
 * Lightweight, cached introspection of the raw `payments` table columns.
 *
 * The challenge dataset's exact column set beyond the core dictionary fields
 * (session_key, merchant_key, category_id, category_title, amount,
 * session_status, created_at, try_seq, try_created_at, verify_type) is not
 * guaranteed. Optional evidence columns (response codes, PSP, terminal, issuer
 * bank, verified_at, settled_at, merchant_name) are exposed by the API only
 * when actually present in the dataset, so responses stay stable and typed
 * regardless of the dataset variant.
 */

let paymentColumns: Set<string> | null = null;

export function getPaymentColumns(): Set<string> {
  if (paymentColumns === null) {
    const rows = getDatabase()
      .prepare("PRAGMA table_info(payments)")
      .all() as Array<{ name: string }>;
    paymentColumns = new Set(rows.map((row) => row.name));
  }
  return paymentColumns;
}

export function hasPaymentColumn(name: string): boolean {
  return getPaymentColumns().has(name);
}

/**
 * Returns the first column of `candidates` that exists in the dataset, or null.
 * Candidate order expresses preference.
 */
export function pickPaymentColumn(candidates: string[]): string | null {
  const columns = getPaymentColumns();
  for (const candidate of candidates) {
    if (columns.has(candidate)) {
      return candidate;
    }
  }
  return null;
}
