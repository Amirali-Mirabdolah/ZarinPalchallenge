# OpenSpec — ZarinPal Merchant Intelligence MVP

This project uses a modular specification structure. This file is the concise source-of-truth index for the product. Detailed domain-level requirements live in the files under the OpenSpec directory.

## Core product statement
Build a merchant-operations product that identifies merchants needing attention, explains why they are failing, and makes the issue traceable to the underlying session and attempt evidence.

## Source modules
- [OpenSpec/01-product-context.md](./OpenSpec/01-product-context.md) — product goals, users, workflow, and constraints
- [OpenSpec/02-insights-and-metrics.md](./OpenSpec/02-insights-and-metrics.md) — validated findings, data semantics, metrics, and grain rules
- [OpenSpec/03-merchant-triage.md](./OpenSpec/03-merchant-triage.md) — merchant prioritization, ranking logic, and merchant detail requirements
- [OpenSpec/04-session-traceability.md](./OpenSpec/04-session-traceability.md) — merchant-to-session-to-attempt drill-down and lifecycle semantics
- [OpenSpec/05-category-and-verification.md](./OpenSpec/05-category-and-verification.md) — category benchmarks and verification-mode diagnostics
- [OpenSpec/06-scope-and-roadmap.md](./OpenSpec/06-scope-and-roadmap.md) — included features, exclusions, future opportunities, and open questions

## Shared architectural rules
- Session-level metrics are the primary business lens.
- Attempt-level metrics are operational detail only.
- `amount` must not be double-counted across attempts from the same session.
- `session_status` and `try_status` are distinct and must remain separate in the UI and implementation.
- `Paid` and `Verified` are different stages in the payment lifecycle and must not be flattened into a single success state.
- Product logic must be merchant-centric and evidence-led, not generic BI-first.

## MVP focus
- merchant health and triage
- retry-loss diagnosis
- category-adjusted merchant comparison
- session traceability and lifecycle clarity
- actionable merchant investigation rather than broad reporting
