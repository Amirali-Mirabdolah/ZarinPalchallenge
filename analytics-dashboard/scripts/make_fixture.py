#!/usr/bin/env python3
"""Create deterministic SQLite fixtures for API-layer validation.

The real challenge dataset (data/challenge_data.sqlite) is not committed to the
repository. This script generates small, deterministic `payments` tables with
known merchant/session/attempt facts so the API can be validated end-to-end
against stable anchors (session grain, retry semantics, rates bounded 0..100).

Usage:
  python scripts/make_fixture.py /tmp/api_fixture.sqlite
  python scripts/make_fixture.py /tmp/api_fixture_numeric.sqlite --numeric
  python scripts/make_fixture.py /tmp/api_fixture_minimal.sqlite --minimal

The generated files are NOT part of the repository.
"""
from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# session_key -> session facts
# attempts: (try_seq, try_status, response_code, psp, terminal, issuer_bank,
#            try_created_at, amount)
SESSIONS = {
    # M1 "AlphaPay" — cat_1 Education, mixed verification
    "s1": {
        "merchant": "M1", "amount": 1000, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-25 10:00:00",
        "attempts": [
            (1, "Failed", 401, "psp_a", "t1", "b1", "2024-06-25 10:00:00", 1000),
            (2, "Failed", 412, "psp_a", "t1", "b2", "2024-06-25 10:05:00", 1000),
        ],
    },
    "s2": {
        "merchant": "M1", "amount": 500, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-19 09:00:00",
        "attempts": [(1, "Failed", 402, "psp_a", "t1", "b1", "2024-06-19 09:00:00", 500)],
    },
    "s3": {
        "merchant": "M1", "amount": 300, "status": "Verified", "verify": "Manual",
        "created_at": "2024-06-21 11:00:00",
        "attempts": [(1, "Verified", 100, "psp_a", "t2", "b1", "2024-06-21 11:00:00", 300)],
        "verified_at": "2024-06-21 11:01:00", "settled_at": "2024-06-21 11:02:00",
    },
    "s4": {
        "merchant": "M1", "amount": 200, "status": "Paid", "verify": "Manual",
        "created_at": "2024-06-22 12:00:00",
        "attempts": [(1, "Paid", 100, "psp_a", "t2", "b1", "2024-06-22 12:00:00", 200)],
    },
    "s5": {
        "merchant": "M1", "amount": 400, "status": "Reversed", "verify": "Manual",
        "created_at": "2024-06-23 13:00:00",
        "attempts": [(1, "Reversed", 200, "psp_a", "t2", "b1", "2024-06-23 13:00:00", 400)],
    },
    "s6": {
        "merchant": "M1", "amount": 150, "status": "NoAttempt", "verify": "Manual",
        "created_at": "2024-06-24 14:00:00",
        "attempts": [(0, "NoAttempt", None, "psp_a", "t2", "b1", "2024-06-24 14:00:00", 150)],
    },
    # M2 "BetaPay" — cat_1 Education, all Automated
    "s7": {
        "merchant": "M2", "amount": 2000, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-27 08:00:00",
        "attempts": [
            (1, "Failed", 410, "psp_b", "t3", "b3", "2024-06-27 08:00:00", 2000),
            (2, "Failed", 411, "psp_b", "t3", "b3", "2024-06-27 08:01:00", 2000),
            (3, "Failed", 412, "psp_b", "t3", "b4", "2024-06-27 08:02:00", 2000),
        ],
    },
    "s8": {
        "merchant": "M2", "amount": 250, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-19 09:00:00",
        "attempts": [(1, "Failed", 402, "psp_b", "t3", "b3", "2024-06-19 09:00:00", 250)],
    },
    "s9": {
        "merchant": "M2", "amount": 3000, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-05 10:00:00",
        "attempts": [(1, "Failed", 401, "psp_b", "t3", "b3", "2024-06-05 10:00:00", 3000)],
    },
    "s10": {
        "merchant": "M2", "amount": 100, "status": "Verified", "verify": "Automated",
        "created_at": "2024-06-06 11:00:00",
        "attempts": [(1, "Verified", 100, "psp_b", "t3", "b3", "2024-06-06 11:00:00", 100)],
        "verified_at": "2024-06-06 11:00:30",
    },
    # M3 "GammaCo" — cat_2 Retail
    "s11": {
        "merchant": "M3", "amount": 4000, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-26 09:00:00",
        "attempts": [
            (1, "Failed", 410, "psp_a", "t4", "b5", "2024-06-26 09:00:00", 4000),
            (2, "Failed", 412, "psp_a", "t4", "b5", "2024-06-26 09:10:00", 4000),
        ],
    },
    "s12": {
        "merchant": "M3", "amount": 600, "status": "Verified", "verify": "Manual",
        "created_at": "2024-06-11 10:00:00",
        "attempts": [(1, "Verified", 100, "psp_a", "t4", "b5", "2024-06-11 10:00:00", 600)],
        "verified_at": "2024-06-11 10:01:00",
    },
    # M4 "DeltaShop" — cat_2 Retail, all Manual
    "s13": {
        "merchant": "M4", "amount": 100, "status": "Failed", "verify": "Manual",
        "created_at": "2024-06-12 10:00:00",
        "attempts": [(1, "Failed", 403, "psp_a", "t2", "b6", "2024-06-12 10:00:00", 100)],
    },
    "s14": {
        "merchant": "M4", "amount": 900, "status": "Verified", "verify": "Manual",
        "created_at": "2024-06-13 11:00:00",
        "attempts": [(1, "Verified", 100, "psp_a", "t2", "b6", "2024-06-13 11:00:00", 900)],
        "verified_at": "2024-06-13 11:00:00",
    },
    "s15": {
        "merchant": "M4", "amount": 800, "status": "Verified", "verify": "Manual",
        "created_at": "2024-06-14 12:00:00",
        "attempts": [(1, "Verified", 100, "psp_a", "t2", "b6", "2024-06-14 12:00:00", 800)],
        "verified_at": "2024-06-14 12:00:00",
    },
    # M5 "EpsilonNet" — cat_3 Network, all Automated
    "s16": {
        "merchant": "M5", "amount": 700, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-10 13:00:00",
        "attempts": [
            (1, "Failed", 410, "psp_a", "t2", "b7", "2024-06-10 13:00:00", 700),
            (2, "Failed", 412, "psp_a", "t2", "b7", "2024-06-10 13:05:00", 700),
        ],
    },
    "s17": {
        "merchant": "M5", "amount": 300, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-18 14:00:00",
        "attempts": [(1, "Failed", 402, "psp_a", "t2", "b7", "2024-06-18 14:00:00", 300)],
    },
    "s18": {
        "merchant": "M5", "amount": 200, "status": "Failed", "verify": "Automated",
        "created_at": "2024-06-22 15:00:00",
        "attempts": [(1, "Failed", 401, "psp_a", "t1", "b7", "2024-06-22 15:00:00", 200)],
    },
    "s19": {
        "merchant": "M5", "amount": 50, "status": "Verified", "verify": "Automated",
        "created_at": "2024-06-16 16:00:00",
        "attempts": [(1, "Verified", 100, "psp_a", "t1", "b7", "2024-06-16 16:00:00", 50)],
        "verified_at": "2024-06-16 16:01:00",
    },
    # M6 "ZetaBank" — cat_4 Finance, all Manual
    "s20": {
        "merchant": "M6", "amount": 5000, "status": "Verified", "verify": "Manual",
        "created_at": "2024-06-08 10:00:00",
        "attempts": [(1, "Verified", 100, "psp_a", "t3", "b8", "2024-06-08 10:00:00", 5000)],
        "verified_at": "2024-06-08 10:00:05",
    },
    "s21": {
        "merchant": "M6", "amount": 6000, "status": "Paid", "verify": "Manual",
        "created_at": "2024-06-09 11:00:00",
        "attempts": [(1, "Paid", 100, "psp_a", "t3", "b8", "2024-06-09 11:00:00", 6000)],
    },
    # M7 "EtaNet" — cat_3 Network, all Automated
    "s22": {
        "merchant": "M7", "amount": 250, "status": "Verified", "verify": "Automated",
        "created_at": "2024-06-15 09:00:00",
        "attempts": [(1, "Verified", 100, "psp_b", "t4", "b9", "2024-06-15 09:00:00", 250)],
        "verified_at": "2024-06-15 09:00:10",
    },
    "s23": {
        "merchant": "M7", "amount": 350, "status": "Verified", "verify": "Automated",
        "created_at": "2024-06-16 10:00:00",
        "attempts": [(1, "Verified", 100, "psp_b", "t4", "b9", "2024-06-16 10:00:00", 350)],
        "verified_at": "2024-06-16 10:00:20",
    },
}

MERCHANTS = {
    "M1": ("AlphaPay", "cat_1", "Education"),
    "M2": ("BetaPay", "cat_1", "Education"),
    "M3": ("GammaCo", "cat_2", "Retail"),
    "M4": ("DeltaShop", "cat_2", "Retail"),
    "M5": ("EpsilonNet", "cat_3", "Network"),
    "M6": ("ZetaBank", "cat_4", "Finance"),
    "M7": ("EtaNet", "cat_3", "Network"),
}

CORE_COLUMNS = [
    "session_key TEXT",
    "merchant_key TEXT",
    "category_id TEXT",
    "category_title TEXT",
    "amount REAL",
    "session_status TEXT",
    "try_seq INTEGER",
    "try_status TEXT",
    "created_at TEXT",
    "try_created_at TEXT",
    "verify_type TEXT",
]

OPTIONAL_COLUMNS = [
    "verified_at TEXT",
    "settled_at TEXT",
    "response_code TEXT",
    "psp TEXT",
    "terminal TEXT",
    "issuer_bank TEXT",
    "merchant_name TEXT",
]


def to_epoch(value: str) -> int:
    dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def build_rows(numeric: bool, minimal: bool) -> list[tuple]:
    rows = []
    for session_key, facts in SESSIONS.items():
        merchant_key = facts["merchant"]
        merchant_name, category_id, category_title = MERCHANTS[merchant_key]
        for try_seq, try_status, response_code, psp, terminal, issuer_bank, try_created_at, amount in facts["attempts"]:
            row = {
                "session_key": session_key,
                "merchant_key": merchant_key,
                "category_id": category_id,
                "category_title": category_title,
                "amount": float(amount),
                "session_status": facts["status"],
                "try_seq": try_seq,
                "try_status": try_status,
                "created_at": facts["created_at"],
                "try_created_at": try_created_at,
                "verify_type": facts["verify"],
                "verified_at": facts.get("verified_at"),
                "settled_at": facts.get("settled_at"),
                "response_code": str(response_code) if response_code is not None else None,
                "psp": psp,
                "terminal": terminal,
                "issuer_bank": issuer_bank,
                "merchant_name": merchant_name,
            }
            if numeric:
                row["created_at"] = to_epoch(row["created_at"])
                row["try_created_at"] = to_epoch(row["try_created_at"])
                if row["verified_at"]:
                    row["verified_at"] = to_epoch(row["verified_at"])
                if row["settled_at"]:
                    row["settled_at"] = to_epoch(row["settled_at"])
            if minimal:
                for column in ("verified_at", "settled_at", "response_code", "psp", "terminal", "issuer_bank", "merchant_name"):
                    row[column] = None
            rows.append(row)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a deterministic API-test fixture SQLite file.")
    parser.add_argument("output", type=Path, help="Output SQLite path")
    parser.add_argument("--numeric", action="store_true", help="Store timestamps as unix epoch numbers")
    parser.add_argument("--minimal", action="store_true", help="Only core data-dictionary columns (no optional evidence columns)")
    args = parser.parse_args()

    columns = CORE_COLUMNS + ([] if args.minimal else OPTIONAL_COLUMNS)
    column_names = [column.split()[0] for column in columns]
    rows = [
        tuple(row[name] for name in column_names)
        for row in build_rows(numeric=args.numeric, minimal=args.minimal)
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(args.output))
    try:
        conn.execute("DROP TABLE IF EXISTS payments")
        if args.numeric:
            # Timestamps stored as epoch numbers, as a real numeric-mode dataset would.
            columns = [
                col if not col.startswith(("created_at ", "try_created_at ", "verified_at ", "settled_at "))
                else col.replace("TEXT", "INTEGER")
                for col in columns
            ]
        conn.execute(f"CREATE TABLE payments ({', '.join(columns)})")
        placeholders = ", ".join("?" for _ in columns)
        conn.executemany(f"INSERT INTO payments VALUES ({placeholders})", rows)
        conn.execute("CREATE INDEX idx_payments_session_key ON payments(session_key)")
        conn.execute("CREATE INDEX idx_payments_merchant_key ON payments(merchant_key)")
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0]
        print(f"Fixture written to {args.output}: {count} attempt rows, {len(SESSIONS)} sessions, {len(MERCHANTS)} merchants")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
