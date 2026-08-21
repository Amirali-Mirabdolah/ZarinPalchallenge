# Session Traceability

## Objective
Allow a merchant operations user to move from merchant-level risk to the exact session and attempt evidence behind the problem.

## Drill-down path
Merchant -> session -> attempts -> PSP and bank signals -> timing -> final outcome

## Required session detail
A selected session must clearly separate:
- session status
- attempt status
- Paid
- Verified
- Failed
- Reversed
- NoAttempt

## Why this matters
The product must distinguish final session state from individual attempt state. An attempt can fail while the session eventually succeeds, or a payment can be Paid before final verification. These lifecycle stages must not be conflated in the UI.

## Session evidence to expose
- attempt count and retry sequence
- attempt-by-attempt status progression
- response code and PSP code
- issuer bank code
- verification type
- timing markers: created_at, try_created_at, verified_at, settled_at
- final session outcome and whether the payment completed successfully

## Retry trace requirements
For retry-heavy sessions, the UI should show:
- attempt sequence by `try_seq`
- time between retries
- when the failure pattern begins
- what turned a recoverable attempt into a final failed session
- whether the session eventually reached `Verified` or ended in `Failed`

## Traceability principle
Every merchant-level claim must be traceable back to a specific set of sessions and attempts, and never to a single aggregate number without evidence.

## Cross references
- See [02-insights-and-metrics.md](./02-insights-and-metrics.md) for the metric and grain logic behind the traceability model.
- See [03-merchant-triage.md](./03-merchant-triage.md) for why the session evidence matters to merchant prioritization.
