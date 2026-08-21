import Database from "better-sqlite3";
import path from "node:path";

export function getDatabasePath() {
  // Dataset is stored at the repository root in `data/`.
  // Use a stable path relative to the application folder.
  return path.resolve(process.cwd(), "../data/challenge_data.sqlite");
}

export const db = new Database(getDatabasePath(), { readonly: true });

export function getPaymentRowCount() {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM payments")
    .get() as { count: number } | undefined;

  return row?.count ?? 0;
}
