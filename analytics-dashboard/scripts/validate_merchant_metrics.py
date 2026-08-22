#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "challenge_data.sqlite"
EXPECTED_RETRY_SESSIONS = 32696
EXPECTED_RETRY_FINAL_FAILURES = 15029
EXPECTED_TOP10_FAILED_VALUE_SHARE = 81.3
TOP10_SHARE_TOLERANCE = 0.5


def session_rollup(conn: sqlite3.Connection):
    return conn.execute(
        """
        SELECT
          session_key,
          merchant_key,
          MAX(amount) AS amount,
          MAX(session_status) AS session_status,
          COUNT(CASE WHEN try_seq > 0 THEN 1 END) AS attempt_count,
          MAX(try_seq) AS max_try_seq,
          MAX(verify_type) AS verify_type
        FROM payments
        GROUP BY session_key, merchant_key
        ORDER BY session_key
        """
    ).fetchall()


def merchant_summary_rows(conn: sqlite3.Connection):
    return conn.execute(
        """
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
        """
    ).fetchall()


def retry_session_counts(conn: sqlite3.Connection):
    retry_sessions = conn.execute(
        """
        SELECT COUNT(*)
        FROM (
          SELECT session_key
          FROM payments
          GROUP BY session_key
          HAVING COUNT(*) > 1
        )
        """
    ).fetchone()[0]

    retry_final_failures = conn.execute(
        """
        WITH session_rollup AS (
          SELECT
            session_key,
            MAX(session_status) AS session_status,
            COUNT(*) AS attempt_count
          FROM payments
          GROUP BY session_key
        )
        SELECT COUNT(*)
        FROM session_rollup
        WHERE attempt_count > 1
          AND session_status = 'Failed'
        """
    ).fetchone()[0]

    return retry_sessions, retry_final_failures


def failed_value_totals(conn: sqlite3.Connection):
    attempt_failed_value = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE session_status = 'Failed'"
    ).fetchone()[0]

    session_failed_value = conn.execute(
        """
        WITH session_rollup AS (
          SELECT
            merchant_key,
            session_key,
            MAX(session_status) AS session_status,
            MAX(amount) AS amount
          FROM payments
          GROUP BY merchant_key, session_key
        )
        SELECT COALESCE(SUM(amount), 0)
        FROM session_rollup
        WHERE session_status = 'Failed'
        """
    ).fetchone()[0]

    return float(attempt_failed_value), float(session_failed_value)


def top10_failed_value_share(conn: sqlite3.Connection):
    rows = conn.execute(
        """
        WITH session_rollup AS (
          SELECT
            merchant_key,
            session_key,
            MAX(session_status) AS session_status,
            MAX(amount) AS amount
          FROM payments
          GROUP BY merchant_key, session_key
        ), merchant_failed_value AS (
          SELECT merchant_key,
                 SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END) AS failed_value
          FROM session_rollup
          GROUP BY merchant_key
        ), total_failed_value AS (
          SELECT SUM(failed_value) AS total_failed_value
          FROM merchant_failed_value
        )
        SELECT merchant_key,
               failed_value,
               ROUND(100.0 * failed_value / total_failed_value, 2) AS pct_of_total
        FROM merchant_failed_value, total_failed_value
        ORDER BY failed_value DESC
        LIMIT 10
        """
    ).fetchall()

    top10_failed_value = sum(float(row[1]) for row in rows)
    total_failed_value = conn.execute(
        """
        WITH session_rollup AS (
          SELECT
            merchant_key,
            session_key,
            MAX(session_status) AS session_status,
            MAX(amount) AS amount
          FROM payments
          GROUP BY merchant_key, session_key
        )
        SELECT COALESCE(SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END), 0)
        FROM session_rollup
        """
    ).fetchone()[0]

    total_failed_value = float(total_failed_value)
    share = (top10_failed_value / total_failed_value * 100.0) if total_failed_value else 0.0
    return top10_failed_value, total_failed_value, share, rows


def validate_dataset(db_path: str | Path):
    db_path = Path(db_path)
    if not db_path.exists():
        print(f"SQLite dataset not found at: {db_path}")
        return 2

    conn = sqlite3.connect(str(db_path))
    try:
        session_rows = session_rollup(conn)
        session_key_counts = conn.execute(
            """
            SELECT session_key, COUNT(*)
            FROM (
              SELECT session_key, merchant_key, MAX(amount) AS amount, MAX(session_status) AS session_status
              FROM payments
              GROUP BY session_key, merchant_key
            )
            GROUP BY session_key
            HAVING COUNT(*) > 1
            """
        ).fetchall()

        merchant_rows = merchant_summary_rows(conn)

        issues = []
        if session_key_counts:
            issues.append(f"Duplicate session aggregate rows detected: {len(session_key_counts)} session keys repeated")

        for merchant_key, sessions, fail_rate, failed_value in merchant_rows:
            if fail_rate < 0.0 or fail_rate > 100.0:
                issues.append(
                    f"{merchant_key}: fail_rate out of range ({fail_rate}%) for {sessions} sessions"
                )

        session_grain_total = conn.execute(
            """
            WITH session_rollup AS (
              SELECT
                merchant_key,
                session_key,
                MAX(session_status) AS session_status,
                MAX(amount) AS amount
              FROM payments
              GROUP BY merchant_key, session_key
            )
            SELECT COALESCE(SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END), 0)
            FROM session_rollup
            """
        ).fetchone()[0]

        merchant_failed_sum = conn.execute(
            """
            WITH session_rollup AS (
              SELECT
                merchant_key,
                session_key,
                MAX(session_status) AS session_status,
                MAX(amount) AS amount
              FROM payments
              GROUP BY merchant_key, session_key
            )
            SELECT COALESCE(SUM(failed_value), 0)
            FROM (
              SELECT SUM(CASE WHEN session_status = 'Failed' THEN amount ELSE 0 END) AS failed_value
              FROM session_rollup
              GROUP BY merchant_key
            )
            """
        ).fetchone()[0]

        if abs(float(session_grain_total) - float(merchant_failed_sum)) > 1:
            issues.append(
                f"Merchant failed-value total mismatch: session-grain total {session_grain_total} != merchant total {merchant_failed_sum}"
            )

        attempt_failed_value, session_failed_value = failed_value_totals(conn)
        if not (session_failed_value <= attempt_failed_value):
            issues.append(
                f"Session-grain failed value exceeded attempt-grain failed value: {session_failed_value} > {attempt_failed_value}"
            )

        retry_sessions, retry_final_failures = retry_session_counts(conn)
        if abs(retry_sessions - EXPECTED_RETRY_SESSIONS) > 1:
            issues.append(
                f"Retry-session count mismatch: expected ~{EXPECTED_RETRY_SESSIONS}, observed {retry_sessions}"
            )
        if abs(retry_final_failures - EXPECTED_RETRY_FINAL_FAILURES) > 1:
            issues.append(
                f"Retry-final-failure count mismatch: expected ~{EXPECTED_RETRY_FINAL_FAILURES}, observed {retry_final_failures}"
            )

        _, _, top10_share, _ = top10_failed_value_share(conn)
        if abs(top10_share - EXPECTED_TOP10_FAILED_VALUE_SHARE) > TOP10_SHARE_TOLERANCE:
            issues.append(
                f"Top-10 failed-value concentration mismatch: expected ~{EXPECTED_TOP10_FAILED_VALUE_SHARE}%, observed {top10_share:.2f}%"
            )

        if issues:
            print("VALIDATION FAILED")
            for issue in issues:
                print(f"- {issue}")
            return 1

        print("VALIDATION PASSED")
        print(f"Session rows: {len(session_rows)}")
        print(f"Active merchants in summary: {len(merchant_rows)}")
        print(f"Attempt failed value: {attempt_failed_value:,.0f}")
        print(f"Session failed value: {session_failed_value:,.0f}")
        print(f"Retry sessions: {retry_sessions}")
        print(f"Retry final failures: {retry_final_failures}")
        print(f"Top-10 failed-value share: {top10_share:.2f}%")
        return 0
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Validate merchant metrics against the challenge dataset.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Path to the SQLite DB")
    args = parser.parse_args()
    return validate_dataset(args.db)


if __name__ == "__main__":
    raise SystemExit(main())
