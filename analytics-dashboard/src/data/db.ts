import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_FILENAME = "challenge_data.sqlite";
let db: Database | null = null;

export function getDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH?.trim();

  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }

  return path.resolve(process.cwd(), "../data", DEFAULT_DB_FILENAME);
}

export function getDatabase() {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `SQLite database not found at ${dbPath}. Expected the challenge dataset under repo data/ or set DATABASE_PATH to the correct SQLite file.`
    );
  }

  db = new Database(dbPath, { readonly: true });
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

export function getPaymentRowCount() {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) AS count FROM payments")
    .get() as { count: number } | undefined;

  return row?.count ?? 0;
}
