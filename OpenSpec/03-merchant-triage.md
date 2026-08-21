# Merchant Triage

## Objective
Rank merchants by the operational risk they create for the business and provide a short list of merchants that deserve immediate investigation.

## Priority signals
A merchant should be prioritized when it shows a material combination of:
- failed-value exposure at the session grain
- retry-loss value at the session grain
- elevated final-session failure rate
- category-adjusted underperformance
- excessive automation share in the payment flow

## Ranking logic
The merchant list should be driven by a simple operational priority model, not a generalized scorecard:
- first sort by failed value
- then layer in retry-loss share
- then compare against category benchmark
- then flag merchants with repeated retry loops or abnormal automation mix

## Actionability rules
A merchant becomes immediately actionable when one or more of the following are true:
- failed value is materially above peer merchants in the same category
- retry sessions comprise a meaningful share of the merchant’s total value
- the merchant’s failed-session rate is materially worse than its category benchmark
- the merchant’s flow is heavily Automated and the failure rate is above the category median

## Merchant detail requirements
After selecting a merchant, the operator should see:
- final outcome mix across sessions: Failed / Verified / Paid / Reversed
- failed-value concentration and failed-session rate
- retry session share and retry-loss impact
- category benchmark comparison
- verification-mode mix (Automated vs Manual)
- terminal or PSP risk clusters when present in the merchant’s data

## Output and UX intent
This page is a diagnostic workspace, not a generic dashboard. It supports one question: “Why is this merchant at risk, and what evidence supports that?”

## Cross references
- Reuse the grain rules and metric definitions from [02-insights-and-metrics.md](./02-insights-and-metrics.md).
- See [04-session-traceability.md](./04-session-traceability.md) for the drill-down from merchant to session.
- See [05-category-and-verification.md](./05-category-and-verification.md) for category comparisons and verification-mode interpretation.
