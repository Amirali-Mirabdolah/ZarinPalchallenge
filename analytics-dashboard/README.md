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

## API layer (P2-A)

HTTP API implemented per `../OpenSpec/07-ui-ux-spec.md`. Routes live in `src/app/api/`, request validation in `src/api/`, and all SQL in `src/data/api-queries.ts` (session-grain rollup rules identical to `src/data/aggregates.ts`). Every user-controlled value is a bound SQL parameter; sort fields resolve only through allowlists. Rates are percentages bounded to 0..100; amounts are IRR.

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/merchants` | Merchant triage list (server-side filtering, multi-column sorting, pagination) |
| `GET /api/merchant/:merchant_key/summary` | Merchant investigation metrics + evidence (outcome mix, category benchmark, verification modes, PSP/terminal clusters, evidence links) |
| `GET /api/merchant/:merchant_key/sessions` | Session-grain evidence list for a merchant (filters, sorting, pagination) |
| `GET /api/session/:session_key` | Full attempt-level trace for a single session (session vs attempt state kept separate) |

### Query parameters

`/api/merchants`: `start`, `end` (ISO dates, inclusive; default scope = full dataset), `category` (matches `category_id` or `category_title`), `verification` (`Automated`/`Manual`), `psp`, `terminal` (rejected with 400 when the dataset lacks the column), `min_amount`, `max_amount`, `min_failed_value`, `min_retry_loss_value`, `min_retry_share` (0–100, RetryHeavy preset), `sort` (comma-separated `field[:asc|:desc]`, default `failed_value:desc,retry_loss_value:desc,failed_session_rate:desc,category_delta:desc`), `page` (≥1), `page_size` (1–200, default 25).

`/api/merchant/:merchant_key/sessions`: `start`, `end`, `status` (comma-separated `Paid`/`Verified`/`Failed`/`Reversed`/`NoAttempt`), `retry` (`true`/`false`), `verification`, `min_amount`, `max_amount`, `sort` (default `failed_value:desc,amount:desc,created_at:desc`), `page`, `page_size` (default 50).

`/api/merchant/:merchant_key/summary` and `/api/session/:session_key` take no query parameters.

### Response conventions

- 200 with the documented JSON shape; `pagination` = `{page, page_size, total, total_pages, has_next, has_prev}`.
- 400 `{error:{code:"invalid_parameter", message, details:{param, allowed?}}}` for invalid/missing parameters.
- 404 `{error:{code:"merchant_not_found"|"session_not_found", ...}}` for unknown keys.
- 500 `{error:{code:"database_unavailable"|"internal_error", ...}}` for data-layer failures (e.g. missing SQLite file).
- Every response with aggregated metrics includes `evidence` links (or per-row `evidence_links`) pointing at the composing sessions, per OpenSpec/07.
- Optional raw columns (`merchant_name`, `response_code`, `psp`, `terminal`, `issuer_bank`, `verified_at`, `settled_at`) are exposed only when present in the dataset; shapes stay stable otherwise. Timestamps are compared as strings for ISO-8601 datasets and numerically (epoch) when the dataset stores numbers.

### API tests (deterministic fixtures)

The real dataset is not committed; `scripts/make_fixture.py` generates deterministic fixtures with known anchors:

```bash
python3 scripts/make_fixture.py /tmp/api_fixture.sqlite
python3 scripts/make_fixture.py /tmp/api_fixture_numeric.sqlite --numeric   # epoch timestamps
python3 scripts/make_fixture.py /tmp/api_fixture_minimal.sqlite --minimal   # core columns only

DATABASE_PATH=/tmp/api_fixture.sqlite npm run build
DATABASE_PATH=/tmp/api_fixture.sqlite npm run start &
node scripts/test_api.mjs http://127.0.0.1:3000 full
node scripts/test_api.mjs http://127.0.0.1:3000 numeric   # after restarting with the numeric fixture
node scripts/test_api.mjs http://127.0.0.1:3000 minimal   # after restarting with the minimal fixture
```

The suites cover grain correctness (session-level failed value, retry semantics, 0–100 rate bounds), deterministic pagination/sorting, all filters, parameter validation, unknown-key 404s, SQL-injection resistance, and cross-endpoint consistency.

## Development notes

The scaffold page (`/`) is a placeholder; product UI (triage/investigation/session-trace screens) is out of scope for the API phase.
