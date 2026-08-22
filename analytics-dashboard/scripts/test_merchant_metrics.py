import importlib.util
import sqlite3
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("validate_merchant_metrics.py")
SPEC = importlib.util.spec_from_file_location("validate_merchant_metrics", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class MerchantMetricSessionGrainTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute(
            """
            CREATE TABLE payments (
              session_key TEXT,
              merchant_key TEXT,
              amount REAL,
              session_status TEXT
            )
            """
        )
        self.conn.executemany(
            "INSERT INTO payments (session_key, merchant_key, amount, session_status) VALUES (?, ?, ?, ?)",
            [
                ("s1", "M1", 100.0, "Failed"),
                ("s1", "M1", 100.0, "Failed"),
                ("s2", "M1", 200.0, "Verified"),
                ("s3", "M1", 150.0, "Failed"),
                ("s3", "M1", 150.0, "Failed"),
                ("s4", "M2", 50.0, "Failed"),
            ],
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_merchant_fail_rate_is_session_grain_and_deduplicated(self):
        rows = MODULE.merchant_summary_rows(self.conn)

        self.assertEqual(rows[0][0], "M1")
        self.assertEqual(rows[0][1], 3)
        self.assertAlmostEqual(rows[0][2], 66.67)
        self.assertAlmostEqual(rows[0][3], 250.0)

        self.assertEqual(rows[1][0], "M2")
        self.assertEqual(rows[1][1], 1)
        self.assertAlmostEqual(rows[1][2], 100.0)
        self.assertAlmostEqual(rows[1][3], 50.0)

    def test_retry_counts_and_failed_value_are_not_double_counted(self):
        retry_sessions, retry_failures = MODULE.retry_session_counts(self.conn)
        attempt_failed_value, session_failed_value = MODULE.failed_value_totals(self.conn)

        self.assertEqual(retry_sessions, 2)
        self.assertEqual(retry_failures, 2)
        self.assertGreater(attempt_failed_value, session_failed_value)
        self.assertEqual(session_failed_value, 300.0)
        self.assertEqual(attempt_failed_value, 550.0)


if __name__ == "__main__":
    unittest.main()
