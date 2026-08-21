# UI/UX Specification — MVP (Merchant Ops Investigation)

Source of truth
- This specification is derived from the existing OpenSpec documents in this folder (01–06). Do not change product or metric definitions here; treat those files as authoritative.

Goal
- Translate the approved MVP into a concrete, implementation-ready UI/UX spec that an implementation agent can follow to build the three primary investigation views: Merchant Triage, Merchant Investigation, and Session Trace.

Information architecture & navigation
- Top-level navigation (left rail or top bar):
  - "Triage" (root: /triage) — merchant list and shortlists
  - "Investigate" (merchant detail) — merchant-level workspace
  - "Trace" (session-level detail) — session/attempt inspector
  - "Settings" (deferred)
- Page hierarchy:
  - /triage — Merchant Triage list (default landing page for operators)
  - /merchant/:merchant_key — Merchant Investigation workspace (primary drill target)
  - /merchant/:merchant_key/session/:session_key — Session Trace view
- Breadcrumbs: show "Triage > [Merchant Key] > [Session Key]" on drill-down pages.

Primary components (reusable)
- EntityTable (table component)
  - Configurable columns, server-side paging, sorting, and filtering
  - Row actions: Open Merchant, Quick Metrics tooltip, Open top sessions
- MetricCard (small summarized KPI card)
  - Title, value, delta vs category, help tooltip
- EvidenceList (compact list of sessions or attempts)
  - Row shows key session fields and one-line reason for prioritization
- Timeline (horizontal event timeline)
  - Attempt markers by try_seq with hover for timestamps and evidence
- ResponseBadge / StatusPill
  - Status semantics (Paid, Verified, Failed, Reversed, NoAttempt)
- FilterBar
  - Global filters that apply across pages: date range, category, PSP, terminal, verification type (Automated/Manual), amount range
- Inspector panel (right-side rail)
  - When a row is selected, show quick evidence without full navigation

Design principles
- Every merchant-level signal must be traceable to a specific set of sessions/attempts.
- Avoid opaque single-number risk scores. Prefer ranked lists with explicit contributing signals (failed-value, retry-loss, failure-rate, category-delta).
- Show both session-grain metrics (authoritative) and attempt-grain evidence (supporting).
- Preserve category context in all merchant comparisons.
- Present Automated vs Manual as observed signal, not causal claim.

1) Merchant Triage (page: /triage)
Purpose
- Produce a short, actionable list of merchants that deserve investigation, explaining clearly why each merchant is prioritized.

Layout
- Header: date range picker, category filter, verification-type filter, search box (merchant_key/name), export button
- Top row: MetricCards for global context (Total failed value, Total retry-loss value, Retry-session rate, Top category by failed-value)
- Main: EntityTable (merchant rows) with server-side pagination and sorting
- Right-side Inspector (collapsible): shows top 5 sessions that drive the merchant's priority (evidence list)

Merchant table — required columns (default order)
- Priority reason badges (one or more): e.g., "Failed value high", "Retry-loss heavy", "High failure rate vs category", "High Automated share"
- merchant_key (link to merchant detail)
- merchant_name (if available)
- failed_value (session-grain sum for sessions with final session_status = Failed) — currency-format
- failed_session_rate (%) = failed sessions / total sessions
- retry_sessions_share (%) = retry sessions / total sessions
- retry_loss_value (session-grain sum for retry sessions that end in final failure)
- category (string)
- category_delta (merchant failed-session-rate minus category median) with up/down visual delta
- verification_share (Automated %) — small bar sparkline showing Automated vs Manual share
- last_7d_change (small percentage change compared to previous period)

Priority / sorting rules (default)
- Default sort: failed_value (descending)
- Secondary tie-breakers: retry_loss_value (desc), failed_session_rate (desc), category_delta (desc)
- Allow operator to change sort and apply multi-column sorts.

Filtering
- Filters: date range, category, verification type, PSP, terminal, amount range, min failed_value, min retry_loss_value
- Quick-presets: TopRisk (failed_value > X), RetryHeavy (retry_sessions_share > Y)

Row affordances and explaining "why"
- Each row includes an explicit "Why prioritized" summary (concise sentence built from contributing signals), e.g.:
  "Top failed value (45,000,000 IRR), retry-loss 32% of failed value, failure rate +12pp vs category median."
- Hovering priority badges shows the underlying session sample (top 3 sessions by failed value for that merchant) in a tooltip.
- Click merchant_key to open Merchant Investigation.

Empty / loading / error states
- Empty: show guidance text: "No merchants match these filters" and offer to widen date range or remove filters
- Loading: skeleton table rows and greyed-out MetricCards
- Error: show error banner with retry button and link to logs (deferred)

Mobile / responsive
- Collapse less-critical columns behind a "details" expand per row; default visible: merchant_key, failed_value, failed_session_rate, priority badges.

Essential vs deferred
- Essential: Merchant table, priority badges, filters, inspector evidence list, default sorting logic
- Deferred: fully custom export templates, advanced saved views, real-time streaming updates

2) Merchant Investigation (page: /merchant/:merchant_key)
Purpose
- Show the operator all evidence needed to assess why a merchant is risky and whether to escalate.

Layout
- Top header: merchant_key, merchant_name, category, quick actions (flag, add note — deferred), back to Triage
- Top-row MetricCards (session-grain authoritative): failed_value, failed_session_rate, retry_loss_value, retry_session_rate, Automated_share
- Main split area: left (breakdown & charts) / right (session evidence list & inspector)

Left — breakdown and charts
- Outcome mix pie or stacked bar: counts or % of final session outcomes (Failed / Verified / Paid / Reversed / NoAttempt)
- Time-series small area chart: failed_value over selected window (default 30 days)
- Category comparison panel: merchant_failure_rate vs category median with sparkline and delta
- Verification-mode panel: Automated vs Manual share + failure rates for each
- PSP/terminal cluster heatmap or table (if > N terminals) showing failure concentration by PSP/terminal (rows: PSP/terminal, cols: failed_session_rate, retry_rate, failed_value)

Right — evidence / drill list
- EvidenceList (sessions) sorted by failed_value (default) with columns: session_key, final_status, amount, retry_count, try_seq_last, last_try_response_code, try_created_at, short reason (e.g., "retry-loss, final failure")
- Each session row has actions: Open Trace (drill to session), Expand inline for attempt summary, Pin to Inspector

Automated vs Manual diagnostics
- Show both Automated share and the failure rates conditional on verification type; include small explanatory tooltip: "This is an observed association, not causal proof." Source link to OpenSpec/05.

How UI connects metrics to evidence
- Every aggregate metric card has a "View evidence" link that focuses the EvidenceList to the sessions that compose the metric (e.g., clicking failed_value filters list to sessions with final session_status = Failed).
- Category-delta card includes a "Show peers" action to open a small modal listing peer merchants in the same category sorted by failed_session_rate.

Empty / loading / error
- If no sessions for merchant in date range, show guidance and an option to expand date range

Essential vs deferred
- Essential: MetricCards, Outcome mix, EvidenceList with drill to Trace, Category comparison, Verification-mode panel
- Deferred: Inline notes, user flags, deep terminal map visualizations

3) Session Trace (page: /merchant/:merchant_key/session/:session_key)
Purpose
- Provide unambiguous, attempt-level evidence for a single session so operators can determine what went wrong and when.

Layout
- Header: session_key, merchant_key, amount, final session_status, verified_at (if any), timestamps
- Left: Attempt sequence list (vertical) or horizontal Timeline component
- Right: Attempt detail inspector and lifecycle metadata

Attempt list (ordered by try_seq asc)
- For each attempt show:
  - try_seq number
  - try_created_at (timestamp)
  - try_status
  - response code and PSP code
  - issuer bank code
  - attempt amount (note: may be repeated across attempts — UI should explicitly flag repeated-amount semantics)
  - verification_type (if present)
  - small indicator if this attempt led to final Paid or Verified state
- Visual cues:
  - color for status (Failed = red, Paid = amber, Verified = green, Reversed = purple, NoAttempt = grey)
  - time delta between attempts annotated on the timeline

Attempt detail inspector
- When an attempt is selected show full row-level evidence: all raw response fields, any gateway messages, and verification metadata
- Include an expandable raw JSON panel for full record if operator needs exact evidence

Clear separation of concepts
- Prominently display two labeled fields:
  - Session Status: final session_status (Paid / Verified / Failed / Reversed / NoAttempt)
  - Attempt Status: the status of the selected attempt (try_status)
- Provide a clear sentence summarizing final state, e.g.: "Session ended in Failed after 3 attempts; last attempt returned response code 412 (Issuer declined)."

Lifecycle timeline
- Show key timestamps: created_at, try_created_at(s), verified_at, settled_at
- Timeline should allow hover to reveal exact timestamps and which attempt produced which response

Verification information
- Show verification_type and whether the verification was Automated or Manual
- If applicable, show verification timestamps and note that Automated vs Manual is an observed signal

Evidence presentation for retry-heavy sessions
- Collapse/expand long attempt lists, but default expand when retry_count <= 6
- Highlight the attempt where failure pattern began (heuristic: first attempt after which remaining attempts show consistent failing response codes)

Empty / loading / error
- If session not found, show message linking back to merchant and to Triage

Essential vs deferred
- Essential: Attempt list, timeline, attempt inspector, separation of session vs attempt state, raw evidence view
- Deferred: AI-assisted root-cause hints, automated suggested remediation steps

Filters, sorting, and interactions (cross-page)
- Filters apply across pages; when drilling down a merchant, filters persist and can be cleared via a "Reset".
- Server-side pagination for large result sets; default page size small (25 merchants / 50 sessions), configurable
- Clicking metric cards filters evidence lists by metric composition (View evidence action)
- Row-level tooltips show sample sessions without navigation

Visual hierarchy and status semantics
- Use color + icon + textual label for statuses; avoid ambiguous color-only indicators
- Failed_value (currency) and retry_loss_value should be visually prominent in Merchant rows and Merchant header
- Category deltas use delta chips: green (better), red (worse) with absolute and relative change

Data & traceability rules to enforce in UI
- Any displayed aggregated value must include a link or action to show the underlying session set.
- Amount metrics: display both session-grain totals and, when relevant, attempt-grain perspective with clear label to avoid double-counting.
- Paid vs Verified: always show both fields and their timestamps; never conflate into a single success state

Empty/loading/error states
- Global error banner when data reads fail with retry action and contact path
- Loading skeletons for tables and cards
- Empty state guidance tailored per page (how to widen filters or expected sample sizes)

Responsive behavior
- Mobile: collapse table columns, show a focused merchant card view with metric cards and a "View evidence" action that expands into the evidence list
- Desktop: show full table + inspector rail

What is essential for the MVP (minimum to ship)
- /triage page with merchant EntityTable, priority badges, filters, and inspector evidence list
- /merchant/:merchant_key with MetricCards, Outcome mix, Category comparison, Verification-mode panel, EvidenceList, and drill to session
- /merchant/:merchant_key/session/:session_key with attempt list, timeline, attempt inspector, session vs attempt status separation
- Traceability affordances: "View evidence" links/actions from all aggregate cards
- Server-side paging and sorting primitives (implemented in API layer)

Deferred items (post-MVP)
- Inline notes, user flags, and saved views
- Advanced visualizations (PSP heatmaps beyond a basic table)
- Realtime streaming updates and alerting
- Export templates beyond CSV

Appendix — Implementation notes for engineers
- Use session-level aggregates as the primary source of truth (see OpenSpec/02-insights-and-metrics.md). When building tables, the backend should expose both session-grain aggregates and raw attempt sets for traceability.
- API endpoints expected (examples):
  - GET /api/merchants?start=&end=&category=&sort=&page=
  - GET /api/merchant/:merchant_key/summary
  - GET /api/merchant/:merchant_key/sessions?start=&end=&sort=&page=
  - GET /api/session/:session_key
- Each API response that returns aggregated metrics must include an evidence query link or an array of session_keys composing the metric so UI can fetch evidence without ambiguity.

Review summary
- Draft a single OpenSpec/07-ui-ux-spec.md that defines the exact UI pages, components, interactions, and the minimal MVP scope.
- The spec preserves all metric semantics and traceability rules from existing OpenSpec files.
- Next step (if approved): create the file in the repository and iterate on wording after stakeholder review.
