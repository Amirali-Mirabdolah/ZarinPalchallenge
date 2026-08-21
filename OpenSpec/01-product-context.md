# Product Context

## Product intent
Create a merchant-operations product that identifies payment issues early, explains the root cause, and helps teams act on the highest-risk merchants. The product must be designed around merchant investigation, not generic self-service BI.

## Target users
- Merchant operations teams
- Finance and payment managers
- Support teams investigating failed or delayed payment sessions

## Core workflow
1. Identify merchants that need attention
2. Understand why they are problematic
3. Drill into the evidence
4. Trace the issue back to sessions and attempts

## Success conditions
- A merchant ops user can identify the top merchants requiring follow-up in under one minute.
- A support agent can explain the cause of a failed or delayed payment from a single session trace.
- A manager can tell whether a problem is driven by merchant mix, retry behavior, category, or verification mode.

## Product constraints
- The raw dataset is a million-row payment-attempt log; support large-scale aggregation and efficient drill-down.
- Session-level metrics are the primary business lens.
- Attempt-level metrics are an operational detail layer.
- Payment lifecycle semantics are explicit: Attempted, Paid, Verified, Failed, Reversed, NoAttempt.

## Dependencies
- See [02-insights-and-metrics.md](./02-insights-and-metrics.md) for validated findings and grain rules.
- See [03-merchant-triage.md](./03-merchant-triage.md) for ranking and operational priority.
- See [04-session-traceability.md](./04-session-traceability.md) for session and attempt traceability.
- See [05-category-and-verification.md](./05-category-and-verification.md) for contextual benchmarks and mode diagnostics.
- See [06-scope-and-roadmap.md](./06-scope-and-roadmap.md) for MVP boundaries and future opportunities.
