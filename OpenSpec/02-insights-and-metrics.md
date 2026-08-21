# Insights and Metrics

## Validated findings
1. Failure value is concentrated across a small merchant set.
   - Top 10 merchants by failed value account for roughly 81.3% of all failed-value exposure.
   - This supports a triage-first merchant workflow rather than broad KPI review.

2. Retry loops are a meaningful loss channel.
   - 32,696 sessions contain repeated attempts.
   - 15,029 retry sessions end in final failure.
   - Retry-heavy merchants show severe failed-value concentration after repeated attempts.

3. Category risk is structurally different.
   - Education, beauty/retail, and network/internet services show materially higher failure risk at the session grain.
   - Merchant judgment should be context-aware and category-relative.

4. Paid and Verified are sequential states in the same payment lifecycle.
   - Paid means money was deducted before the merchant verified the transaction.
   - Verified is the final successful state.
   - They are not interchangeable outcomes and should not be flattened into a single success bucket.

5. Automated verification is dominant and underperforms manual verification in the observed data.
   - This is a strong operational signal, not a proven causal statement.
   - It must be presented with merchant and category context.

## Data semantics
- `session_key`: unique session identifier
- `try_seq`: attempt number within a session; `0` means no payment attempt
- `session_status`: final status of the entire session
- `try_status`: status of the current attempt
- `amount`: transaction amount in IRR; repeated across attempts in the same session
- `adjusted_fee`: adjusted fee value; relative comparisons remain valid
- `verify_type`: Automated or Manual
- `created_at`: session creation time
- `try_created_at`: attempt creation time
- `verified_at`: verification time
- `settled_at`: settlement time
- `Paid`, `Verified`, `Failed`, `Reversed`, `NoAttempt` have the meanings defined in the official data dictionary

## Grain rules
- Session-level metrics are the authoritative business metrics.
- Attempt-level metrics are operational detail only.
- Any `amount` metric must avoid double-counting repeated attempts from the same session unless the metric explicitly refers to attempt exposure.
- `COUNT(*)` on the raw payment-attempt table is not a session metric.
- `COUNT(DISTINCT session_key)` or a session-level aggregate is the correct denominator for business-value and final-status metrics.

## Required metric definitions
### Session-level metrics
- failed sessions by merchant
- failed value by merchant = sum of session-level amount for sessions with final `session_status = Failed`
- retry session rate = sessions with more than one attempt / total sessions
- retry-loss value = session value for retry sessions that end in final failure
- category session failure rate = failed sessions / total sessions within category
- merchant category-adjusted performance = merchant failure rate vs category benchmark

### Attempt-level metrics
- retry count distribution across attempts
- `try_status` prevalence by attempt number
- response-code distribution by attempt
- timing and sequence analysis for a single session

### Cross-grain metrics
- Automated vs Manual share by merchant and category
- response-code concentration within failed sessions
- attempt-to-final-state conversion within a retry session

## Required transformations
- Session aggregate table: one row per `session_key` with final `session_status`, merchant, category, amount, retry_count, verification type, response clusters, timing markers.
- Retry session table: session rows with `retry_count > 1` and final status.
- Merchant summary table: failed value, retry loss, session failure rate, and category benchmark deltas.
- Attempt timeline table: attempt-level sequence for a single session, ordered by `try_seq`.

## Cross references
- See [03-merchant-triage.md](./03-merchant-triage.md) for ranking and actionability.
- See [04-session-traceability.md](./04-session-traceability.md) for how evidence is presented to operators.
- See [05-category-and-verification.md](./05-category-and-verification.md) for benchmark and verification diagnostics.
