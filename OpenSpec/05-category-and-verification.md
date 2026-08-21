# Category and Verification

## Category context
Category benchmarks should sit next to merchant diagnostics, not as a separate generic BI topic. The product should compare merchants to peers within the same category before judging them as outliers.

## Benchmark rules
- Compare a merchant’s session failure rate to its category median or peer group.
- Show whether the merchant is unusually weak within a category or simply reflects a difficult category-level environment.
- Preserve category context when reporting a merchant health score.

## Verification-mode diagnostics
Verification mode is a useful diagnostic signal, but it is not a root-cause claim.
- Show Automated vs Manual share of sessions
- Show success rate by mode
- Show retry-loss and failed-value concentration by mode
- Present these as evidence for operational investigation rather than causal proof

## Confounder rule
Do not present Automated vs Manual as a universal explanation. It must be interpreted with merchant and category context.

## Cross references
- See [02-insights-and-metrics.md](./02-insights-and-metrics.md) for the metric grain and validation logic.
- See [03-merchant-triage.md](./03-merchant-triage.md) for how category context affects merchant ranking.
