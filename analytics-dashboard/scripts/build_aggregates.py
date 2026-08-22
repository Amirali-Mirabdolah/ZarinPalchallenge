#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_DB = REPO_ROOT / "data" / "challenge_data.sqlite"
DEFAULT_OUTPUT_DB = REPO_ROOT / "data" / "aggregates.sqlite"


SESSION_AGGREGATE_SQL = """
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
  FROM source.payments
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
"""

MERCHANT_AGGREGATE_SQL = """
WITH session_rollup AS (
  SELECT
    merchant_key,
    session_key,
    MAX(session_status) AS session_status,
    MAX(amount) AS amount
  FROM source.payments
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
"""

RETRY_AGGREGATE_SQL = """
WITH session_rollup AS (
  SELECT
    session_key,
    merchant_key,
    MAX(amount) AS amount,
    MAX(session_status) AS session_status,
    COUNT(CASE WHEN try_seq > 0 THEN 1 END) AS attempt_count
  FROM source.payments
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
"""


def ensure_parent(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)


def materialize_aggregates(source_db: Path, output_db: Path):
    if not source_db.exists():
        raise FileNotFoundError(f"Source SQLite database not found: {source_db}")

    ensure_parent(output_db)
    conn = sqlite3.connect(str(output_db))
    try:
        conn.execute(f"ATTACH DATABASE '{source_db.as_posix()}' AS source")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("DROP TABLE IF EXISTS session_aggregate")
        conn.execute("DROP TABLE IF EXISTS merchant_aggregate")
        conn.execute("DROP TABLE IF EXISTS retry_aggregate")

        conn.execute(f"CREATE TABLE session_aggregate AS {SESSION_AGGREGATE_SQL}")

        conn.execute(
            """
            CREATE TABLE merchant_aggregate (
              merchant_key TEXT,
              sessions INTEGER,
              fail_rate REAL,
              failed_value REAL
            )
            """
        )
        conn.execute(f"INSERT INTO merchant_aggregate {MERCHANT_AGGREGATE_SQL}")

        conn.execute(
            """
            CREATE TABLE retry_aggregate (
              session_key TEXT,
              merchant_key TEXT,
              amount REAL,
              session_status TEXT,
              attempt_count INTEGER,
              retry_count INTEGER
            )
            """
        )
        conn.execute(f"INSERT INTO retry_aggregate {RETRY_AGGREGATE_SQL}")

        conn.execute("CREATE INDEX idx_session_aggregate_session_key ON session_aggregate(session_key)")
        conn.execute("CREATE INDEX idx_session_aggregate_merchant_key ON session_aggregate(merchant_key)")
        conn.execute("CREATE INDEX idx_session_aggregate_session_status ON session_aggregate(session_status)")
        conn.execute("CREATE INDEX idx_retry_aggregate_merchant_key ON retry_aggregate(merchant_key)")
        conn.execute("CREATE INDEX idx_retry_aggregate_session_status ON retry_aggregate(session_status)")

        conn.commit()
        print(f"Materialized aggregates to {output_db}")
        print(f"Session rows: {conn.execute('SELECT COUNT(*) FROM session_aggregate').fetchone()[0]}")
        print(f"Merchant rows: {conn.execute('SELECT COUNT(*) FROM merchant_aggregate').fetchone()[0]}")
        print(f"Retry rows: {conn.execute('SELECT COUNT(*) FROM retry_aggregate').fetchone()[0]}")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Create a deterministic session/merchant/retry aggregate SQLite file from the raw payments database.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE_DB, help="Raw source payments SQLite file.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DB, help="Output SQLite file for aggregated data.")
    args = parser.parse_args()

    with sqlite3.connect(str(args.source)) as source_conn:
        source_conn.execute("SELECT 1 FROM payments LIMIT 1")
    materialize_aggregates(args.source, args.output)


if __name__ == "__main__":
    main()
