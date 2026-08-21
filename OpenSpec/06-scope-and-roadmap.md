# Scope and Roadmap

## MVP included
- Merchant prioritization based on failed-value exposure and retry-loss risk
- Session traceability from merchant to final outcome and attempt timeline
- Category-adjusted comparison for merchant benchmarking
- Verification-mode diagnostics presented as observed signal, not causal proof
- Merchant ops workflow for investigation and evidence-led follow-up

## Explicitly excluded from MVP
- Generic self-service BI exploration
- Forecasting or recommendation generation
- Authentication and user management
- Deep warehouse integration beyond the provided dataset
- Advanced instrumentation unrelated to payment investigation

## Future opportunities
- Forecasting of merchant risk over time
- Alerting on retry spikes or abnormal response-code clusters
- More historical benchmarking for merchant performance
- Terminal-level diagnostics and richer operational review
- Exportable evidence packages for merchant support teams

## Open architectural questions
- Should merchant prioritization use a single weighted score or a risk-band model?
- Should category benchmarks be merchant-level only, or also include terminal and PSP segmentation?
- How much retry detail should be surfaced in the default view versus the drill-down path?

## Cross references
- See [01-product-context.md](./01-product-context.md) for the product orientation and success conditions.
- See [02-insights-and-metrics.md](./02-insights-and-metrics.md) for the metric definitions and grain rules.
