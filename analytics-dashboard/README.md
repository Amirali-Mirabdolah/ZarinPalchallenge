This project is the local scaffold for the ZarinPal merchant-operations analytics MVP.

## Data layer

- Source dataset: `../data/challenge_data.sqlite`
- Default DB path: resolved from `process.cwd()` to the repository root `data/challenge_data.sqlite`
- Override with `DATABASE_PATH` if the dataset is stored elsewhere for local analysis

The data layer is intentionally kept separate from UI code. The app reads from SQLite via `src/data/db.ts`, and the aggregate logic is defined in the corresponding data/metric modules.

### Grain rules

- Session-level metrics are the business source of truth.
- Attempt-level metrics are operational detail only.
- `amount` must not be double-counted across repeated attempts in the same session.
- `session_status` and `try_status` are distinct semantics and remain separate.

### ETL / aggregate rebuild

From the app directory:

```bash
python scripts/build_aggregates.py --source ../data/challenge_data.sqlite --output ../data/aggregates.sqlite
```

This rebuilds the local aggregate SQLite file deterministically from the raw `payments` dataset without modifying the source data file.

### Validation

```bash
python scripts/validate_merchant_metrics.py --db ../data/challenge_data.sqlite
python scripts/test_merchant_metrics.py
```

This checks the merchant-level fail-rate bounds, session-grain failed value logic, retry counts, and top-10 failed-value concentration against the validated OpenSpec anchors.

## Development notes

This scaffold is a foundation layer only. Product UI/API implementation remains out of scope for this phase.
