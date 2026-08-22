#!/usr/bin/env node
/**
 * End-to-end HTTP tests for the analytics-dashboard API (P2-A).
 *
 * Requires a running server backed by a fixture database, e.g.:
 *
 *   python3 scripts/make_fixture.py /tmp/api_fixture.sqlite
 *   DATABASE_PATH=/tmp/api_fixture.sqlite npm run build
 *   DATABASE_PATH=/tmp/api_fixture.sqlite npm run start &
 *   node scripts/test_api.mjs http://127.0.0.1:3000
 *
 * Modes (third argument): full (default, text-timestamp fixture),
 * numeric (epoch-second timestamps), minimal (core columns only).
 *
 * Exits non-zero on any failure. No external dependencies.
 */
const BASE_URL = process.argv[2] || "http://127.0.0.1:3000";
const MODE = process.argv[3] || "full";

let passed = 0;
let failed = 0;
const failures = [];
let currentGroup = "";

function group(name) {
  currentGroup = name;
  console.log(`\n== ${name} ==`);
}

function record(ok, label, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    failures.push(`[${currentGroup}] ${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function assertEq(actual, expected, label) {
  record(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertClose(actual, expected, tolerance, label) {
  const ok =
    actual === expected ||
    (typeof actual === "number" && typeof expected === "number" && Math.abs(actual - expected) <= tolerance);
  record(ok, label, `expected ~${expected} ±${tolerance}, got ${actual}`);
}

function assertTrue(value, label) {
  record(value === true, label, `expected true, got ${JSON.stringify(value)}`);
}

function assertDeepEq(actual, expected, label) {
  record(JSON.stringify(actual) === JSON.stringify(expected), label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// 1. Merchants list — default sort & grain anchors
// ---------------------------------------------------------------------------

async function testMerchantsList() {
  group("merchants: default list, grain anchors");

  const r = await get("/api/merchants");
  assertEq(r.status, 200, "merchants returns 200");
  assertEq(r.body.pagination.total, 7, "7 merchants total");
  assertEq(r.body.pagination.page, 1, "default page = 1");
  assertEq(r.body.pagination.page_size, 25, "default page_size = 25 (merchants)");
  assertEq(r.body.pagination.total_pages, 1, "total_pages = 1");
  assertDeepEq(
    r.body.sort.map((s) => s.field),
    ["failed_value", "retry_loss_value", "failed_session_rate", "category_delta"],
    "default sort order matches OpenSpec/07"
  );
  assertDeepEq(
    r.body.merchants.map((m) => m.merchant_key),
    ["M2", "M3", "M1", "M5", "M4", "M6", "M7"],
    "default order: failed_value desc with documented tie-breaks"
  );

  const byKey = Object.fromEntries(r.body.merchants.map((m) => [m.merchant_key, m]));

  // M1 anchors (session grain — s1 has 2 attempts, amount counted once)
  assertEq(byKey.M1.sessions, 6, "M1 sessions = 6 (deduped)");
  assertClose(byKey.M1.failed_session_rate, 33.33, 0.02, "M1 failed_session_rate = 33.33");
  assertEq(byKey.M1.failed_value, 1500, "M1 failed_value = 1500 (session grain, no double count)");
  assertEq(byKey.M1.retry_sessions, 1, "M1 retry_sessions = 1");
  assertClose(byKey.M1.retry_sessions_share, 16.67, 0.02, "M1 retry_sessions_share = 16.67");
  assertEq(byKey.M1.retry_loss_value, 1000, "M1 retry_loss_value = 1000");
  assertEq(byKey.M1.automated_sessions, 2, "M1 automated_sessions = 2");
  assertEq(byKey.M1.manual_sessions, 4, "M1 manual_sessions = 4");
  assertEq(byKey.M1.total_value, 2550, "M1 total_value = 2550");
  assertClose(byKey.M1.automated_share, 33.33, 0.02, "M1 automated_share = 33.33");

  // M2 anchors
  assertEq(byKey.M2.sessions, 4, "M2 sessions = 4");
  assertClose(byKey.M2.failed_session_rate, 75, 0.02, "M2 failed_session_rate = 75");
  assertEq(byKey.M2.failed_value, 5250, "M2 failed_value = 5250");
  assertEq(byKey.M2.retry_loss_value, 2000, "M2 retry_loss_value = 2000 (s7 only)");
  assertEq(byKey.M2.automated_share, 100, "M2 automated_share = 100");

  // M5 / M7 (cat_3 peers)
  assertEq(byKey.M5.failed_value, 1200, "M5 failed_value = 1200");
  assertEq(byKey.M7.sessions, 2, "M7 sessions = 2");
  assertEq(byKey.M7.failed_value, 0, "M7 failed_value = 0");

  // every rate is bounded 0..100
  for (const m of r.body.merchants) {
    record(m.failed_session_rate >= 0 && m.failed_session_rate <= 100, `${m.merchant_key} failed_session_rate within 0..100`);
    record(m.retry_sessions_share >= 0 && m.retry_sessions_share <= 100, `${m.merchant_key} retry_sessions_share within 0..100`);
    record(m.automated_share >= 0 && m.automated_share <= 100, `${m.merchant_key} automated_share within 0..100`);
  }

  // category benchmark
  assertClose(byKey.M2.category_median_failed_session_rate, 54.17, 0.02, "cat_1 median failed_session_rate ~ 54.17");
  assertClose(byKey.M2.category_delta, 20.83, 0.03, "M2 category_delta ~ +20.83");
  assertClose(byKey.M5.category_median_failed_session_rate, 37.5, 0.02, "cat_3 median failed_session_rate = 37.5");
  assertClose(byKey.M5.category_delta, 37.5, 0.02, "M5 category_delta = 37.5");
  assertEq(byKey.M6.category_delta, 0, "M6 category_delta = 0 (sole peer in category)");

  // priority reasons
  assertDeepEq(byKey.M2.priority_reasons.sort(), ["Failed value high", "High Automated share", "High failure rate vs category"].sort(), "M2 priority reasons");
  assertDeepEq(byKey.M1.priority_reasons, ["Retry-loss heavy"], "M1 priority reasons");
  assertTrue(byKey.M2.why_prioritized.startsWith("Prioritized:"), "M2 why_prioritized present");
  assertEq(byKey.M4.priority_reasons.length, 0, "M4 has no priority reasons");

  // evidence links
  assertTrue(byKey.M1.evidence_links.failed_value.href.includes("status=Failed"), "M1 failed_value evidence link filters status=Failed");
  assertTrue(byKey.M1.evidence_links.retry_loss_value.href.includes("retry=true"), "M1 retry_loss evidence link includes retry=true");

  // last_7d_change (dataset window ends 2024-06-27 08:00:00)
  assertClose(byKey.M1.last_7d_change, 100, 0.01, "M1 last_7d_change = +100%");
  assertClose(byKey.M2.last_7d_change, 700, 0.01, "M2 last_7d_change = +700%");
  assertClose(byKey.M5.last_7d_change, -33.33, 0.02, "M5 last_7d_change = -33.33%");
  assertEq(byKey.M3.last_7d_change, null, "M3 last_7d_change = null (no previous-period baseline)");
  assertEq(byKey.M6.last_7d_change, null, "M6 last_7d_change = null (no failed value)");

  if (MODE !== "minimal") {
    assertEq(byKey.M1.merchant_name, "AlphaPay", "M1 merchant_name = AlphaPay");
  } else {
    assertEq(byKey.M1.merchant_name, null, "merchant_name null when column absent");
  }
}

// ---------------------------------------------------------------------------
// 2. Merchants — sorting
// ---------------------------------------------------------------------------

async function testMerchantsSorting() {
  group("merchants: sorting");

  let r = await get("/api/merchants?sort=failed_value:asc");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M6", "M7", "M4", "M5", "M1", "M3", "M2"], "sort=failed_value:asc");
  assertDeepEq(r.body.sort, [{ field: "failed_value", direction: "asc" }], "sort echo");

  r = await get("/api/merchants?sort=sessions:desc");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M1", "M2", "M5", "M4", "M3", "M6", "M7"], "sort=sessions:desc (tie-break merchant_key asc)");

  r = await get("/api/merchants?sort=category_delta:desc,merchant_key:asc");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M5", "M2", "M3", "M6", "M4", "M1", "M7"], "sort=category_delta:desc,merchant_key:asc");

  r = await get("/api/merchants?sort=merchant_key");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M7", "M6", "M5", "M4", "M3", "M2", "M1"], "sort=merchant_key (direction omitted -> desc)");
}

// ---------------------------------------------------------------------------
// 3. Merchants — pagination determinism
// ---------------------------------------------------------------------------

async function testMerchantsPagination() {
  group("merchants: pagination");

  let r = await get("/api/merchants?page=1&page_size=2");
  assertEq(r.body.pagination.total, 7, "page1 total = 7");
  assertEq(r.body.pagination.total_pages, 4, "page1 total_pages = 4");
  assertEq(r.body.pagination.has_next, true, "page1 has_next = true");
  assertEq(r.body.pagination.has_prev, false, "page1 has_prev = false");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M2", "M3"], "page1 rows");

  r = await get("/api/merchants?page=2&page_size=2");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M1", "M5"], "page2 rows");
  assertEq(r.body.pagination.has_next, true, "page2 has_next = true");
  assertEq(r.body.pagination.has_prev, true, "page2 has_prev = true");

  r = await get("/api/merchants?page=3&page_size=2");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M4", "M6"], "page3 rows");

  r = await get("/api/merchants?page=4&page_size=2");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M7"], "page4 rows");
  assertEq(r.body.pagination.has_next, false, "page4 has_next = false");

  r = await get("/api/merchants?page=5&page_size=2");
  assertDeepEq(r.body.merchants, [], "page5 empty");
  assertEq(r.body.pagination.total, 7, "page5 total still 7");

  const [p1a, p1b] = await Promise.all([
    get("/api/merchants?page=1&page_size=3"),
    get("/api/merchants?page=1&page_size=3"),
  ]);
  assertDeepEq(p1a.body.merchants.map((m) => m.merchant_key), p1b.body.merchants.map((m) => m.merchant_key), "repeated page-1 calls are identical");
}

// ---------------------------------------------------------------------------
// 4. Merchants — filters
// ---------------------------------------------------------------------------

async function testMerchantsFilters() {
  group("merchants: filters");

  let r = await get("/api/merchants?category=cat_1");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M1", "M2"], "category=cat_1 (id)");
  r = await get("/api/merchants?category=Education");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M1", "M2"], "category=Education (title)");

  r = await get("/api/merchants?verification=Automated");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M1", "M2", "M3", "M5", "M7"], "verification=Automated");
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M1").sessions, 2, "M1 sessions restricted to automated sessions");

  r = await get("/api/merchants?start=2024-06-24");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M1", "M2", "M3"], "start=2024-06-24");

  r = await get("/api/merchants?start=2024-06-01&end=2024-06-15");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M2", "M3", "M4", "M5", "M6", "M7"], "date range 06-01..06-15");
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M4").failed_value, 100, "M4 failed_value in range = 100 (s13)");

  r = await get("/api/merchants?min_amount=400&max_amount=2000");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M1", "M2", "M3", "M4", "M5"], "amount range 400..2000 (session-grain)");
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M3").sessions, 1, "M3 sessions in amount range = 1 (s12)");

  r = await get("/api/merchants?min_failed_value=4000");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M2", "M3"], "min_failed_value=4000");

  r = await get("/api/merchants?min_retry_loss_value=2000");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M2", "M3"], "min_retry_loss_value=2000");

  r = await get("/api/merchants?min_retry_share=50");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M3"], "min_retry_share=50 (RetryHeavy preset)");

  r = await get("/api/merchants?psp=psp_b");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M2", "M7"], "psp=psp_b keeps full sessions (session-level filter)");
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M2").retry_sessions, 1, "M2 retry_sessions intact under psp filter (no grain corruption)");
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M2").sessions, 4, "M2 sessions with psp_b = 4 (all M2 sessions)");

  r = await get("/api/merchants?terminal=t2");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M1", "M4", "M5"], "terminal=t2");
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M5").retry_sessions, 1, "M5 retry_sessions intact under terminal filter");

  assertEq(r.body.filters.terminal, "t2", "filters echo includes terminal");
}

// ---------------------------------------------------------------------------
// 5. Merchants — parameter validation
// ---------------------------------------------------------------------------

async function testMerchantsValidation() {
  group("merchants: parameter validation");

  let r = await get("/api/merchants?page=0");
  assertEq(r.status, 400, "page=0 -> 400");
  assertEq(r.body.error.code, "invalid_parameter", "page=0 error code");

  r = await get("/api/merchants?page=abc");
  assertEq(r.status, 400, "page=abc -> 400");

  r = await get("/api/merchants?page_size=201");
  assertEq(r.status, 400, "page_size=201 -> 400");
  assertEq(r.body.error.details.param, "page_size", "page_size error param");

  r = await get("/api/merchants?page_size=0");
  assertEq(r.status, 400, "page_size=0 -> 400");

  r = await get("/api/merchants?sort=unknown_field:asc");
  assertEq(r.status, 400, "unknown sort field -> 400");
  assertEq(r.body.error.details.allowed.includes("failed_value"), true, "sort error lists allowed fields");

  r = await get("/api/merchants?sort=failed_value:sideways");
  assertEq(r.status, 400, "invalid sort direction -> 400");

  r = await get("/api/merchants?start=not-a-date");
  assertEq(r.status, 400, "invalid start date -> 400");

  r = await get("/api/merchants?start=2024-02-31");
  assertEq(r.status, 400, "impossible date -> 400");

  r = await get("/api/merchants?start=2024-06-10&end=2024-06-01");
  assertEq(r.status, 400, "start after end -> 400");

  r = await get("/api/merchants?verification=auto");
  assertEq(r.status, 400, "invalid verification -> 400");

  r = await get("/api/merchants?min_amount=100&max_amount=50");
  assertEq(r.status, 400, "min_amount > max_amount -> 400");

  r = await get("/api/merchants?min_retry_share=101");
  assertEq(r.status, 400, "min_retry_share=101 -> 400");

  r = await get("/api/merchants?min_failed_value=-5");
  assertEq(r.status, 400, "negative min_failed_value -> 400");
}

// ---------------------------------------------------------------------------
// 6. Merchant summary
// ---------------------------------------------------------------------------

async function testMerchantSummary() {
  group("merchant summary");

  let r = await get("/api/merchant/M1/summary");
  assertEq(r.status, 200, "M1 summary 200");
  assertEq(r.body.merchant.merchant_key, "M1", "summary merchant_key");
  assertEq(r.body.merchant.category_id, "cat_1", "summary category_id");
  if (MODE !== "minimal") {
    assertEq(r.body.merchant.merchant_name, "AlphaPay", "summary merchant_name");
  }

  assertEq(r.body.metrics.sessions, 6, "M1 summary sessions = 6");
  assertEq(r.body.metrics.failed_sessions, 2, "M1 summary failed_sessions = 2");
  assertClose(r.body.metrics.failed_session_rate, 33.33, 0.02, "M1 summary failed_session_rate");
  assertEq(r.body.metrics.failed_value, 1500, "M1 summary failed_value (session grain)");
  assertEq(r.body.metrics.retry_sessions, 1, "M1 summary retry_sessions");
  assertClose(r.body.metrics.retry_session_rate, 16.67, 0.02, "M1 summary retry_session_rate");
  assertEq(r.body.metrics.retry_loss_value, 1000, "M1 summary retry_loss_value");
  assertEq(r.body.metrics.automated_share, 33.33, "M1 summary automated_share");
  assertEq(r.body.metrics.total_value, 2550, "M1 summary total_value");

  assertDeepEq(
    r.body.outcome_mix.entries.map((e) => `${e.status}:${e.sessions}`).sort(),
    ["Failed:2", "NoAttempt:1", "Paid:1", "Reversed:1", "Verified:1"],
    "M1 outcome mix preserves all five statuses"
  );
  assertEq(r.body.outcome_mix.other_sessions, 0, "M1 outcome_mix.other_sessions = 0");

  const auto = r.body.verification_modes.find((m) => m.verify_type === "Automated");
  const manual = r.body.verification_modes.find((m) => m.verify_type === "Manual");
  assertEq(auto.sessions, 2, "M1 Automated sessions = 2");
  assertEq(auto.failed_session_rate, 100, "M1 Automated failed_session_rate = 100");
  assertEq(auto.failed_value, 1500, "M1 Automated failed_value = 1500");
  assertEq(manual.failed_session_rate, 0, "M1 Manual failed_session_rate = 0");

  if (MODE === "minimal") {
    assertDeepEq(r.body.psp_clusters, [], "psp_clusters empty when column absent");
    assertDeepEq(r.body.terminal_clusters, [], "terminal_clusters empty when column absent");
  } else {
    assertDeepEq(r.body.psp_clusters.map((c) => c.key), ["psp_a"], "M1 psp_clusters = [psp_a]");
    const pspA = r.body.psp_clusters[0];
    assertEq(pspA.sessions, 6, "M1 psp_a cluster sessions = 6");
    assertClose(pspA.failed_session_rate, 33.33, 0.02, "M1 psp_a cluster failed_session_rate = 33.33");
    assertEq(pspA.failed_value, 1500, "M1 psp_a cluster failed_value = 1500 (no attempt double count)");
    assertTrue(r.body.terminal_clusters.length >= 2, "M1 terminal_clusters present");
  }

  assertDeepEq(
    r.body.evidence.top_failed_sessions.map((s) => s.session_key),
    ["s1", "s2"],
    "M1 top failed sessions evidence"
  );
  assertDeepEq(
    r.body.evidence.top_retry_loss_sessions.map((s) => s.session_key),
    ["s1"],
    "M1 top retry-loss sessions evidence"
  );
  assertTrue(r.body.evidence.links.failed_value.href.includes("/api/merchant/M1/sessions"), "M1 evidence link path");

  // M5 summary: category benchmark with peer M7
  r = await get("/api/merchant/M5/summary");
  assertClose(r.body.metrics.category_median_failed_session_rate, 37.5, 0.02, "M5 category median = 37.5");
  assertClose(r.body.metrics.category_delta, 37.5, 0.02, "M5 category_delta = 37.5");

  // unknown merchant
  r = await get("/api/merchant/NO_SUCH_MERCHANT/summary");
  assertEq(r.status, 404, "unknown merchant summary -> 404");
  assertEq(r.body.error.code, "merchant_not_found", "404 code = merchant_not_found");
}

// ---------------------------------------------------------------------------
// 7. Merchant sessions
// ---------------------------------------------------------------------------

async function testMerchantSessions() {
  group("merchant sessions");

  let r = await get("/api/merchant/M2/sessions");
  assertEq(r.status, 200, "M2 sessions 200");
  assertEq(r.body.pagination.total, 4, "M2 sessions total = 4");
  assertEq(r.body.pagination.page_size, 50, "default page_size = 50 (sessions)");
  assertDeepEq(
    r.body.sessions.map((s) => s.session_key),
    ["s9", "s7", "s8", "s10"],
    "M2 sessions default sort (failed_value desc)"
  );

  const s7 = r.body.sessions.find((s) => s.session_key === "s7");
  assertEq(s7.session_status, "Failed", "s7 session_status = Failed");
  assertEq(s7.amount, 2000, "s7 amount = 2000");
  assertEq(s7.attempt_count, 3, "s7 attempt_count = 3");
  assertEq(s7.retry_count, 2, "s7 retry_count = 2 (attempts - 1)");
  assertEq(s7.try_seq_last, 3, "s7 try_seq_last = 3");
  assertEq(s7.reason, "retry-loss, final failure", "s7 reason");
  assertEq(s7.verify_type, "Automated", "s7 verify_type");
  if (MODE === "minimal") {
    assertEq(s7.last_try_response_code, null, "last_try_response_code null when column absent");
  } else {
    assertEq(s7.last_try_response_code, "412", "s7 last_try_response_code = 412");
    const s10 = r.body.sessions.find((s) => s.session_key === "s10");
    assertEq(s10.reason, "verified", "s10 reason = verified");
    assertEq(s10.last_try_response_code, "100", "s10 last_try_response_code = 100");
  }

  // filters
  r = await get("/api/merchant/M2/sessions?status=Failed");
  assertEq(r.body.pagination.total, 3, "M2 status=Failed -> 3 sessions");
  r = await get("/api/merchant/M2/sessions?status=Failed,Verified");
  assertEq(r.body.pagination.total, 4, "M2 status=Failed,Verified -> 4 sessions");
  r = await get("/api/merchant/M2/sessions?retry=true");
  assertDeepEq(r.body.sessions.map((s) => s.session_key), ["s7"], "M2 retry=true -> [s7]");
  r = await get("/api/merchant/M2/sessions?retry=false");
  assertDeepEq(r.body.sessions.map((s) => s.session_key).sort(), ["s10", "s8", "s9"], "M2 retry=false -> non-retry sessions");
  r = await get("/api/merchant/M2/sessions?status=Failed&retry=true");
  assertDeepEq(r.body.sessions.map((s) => s.session_key), ["s7"], "M2 status=Failed&retry=true -> [s7]");
  r = await get("/api/merchant/M1/sessions?min_amount=300&max_amount=1000");
  assertDeepEq(r.body.sessions.map((s) => s.session_key).sort(), ["s1", "s2", "s3", "s5"], "M1 amount range 300..1000");
  r = await get("/api/merchant/M1/sessions?verification=Manual");
  assertEq(r.body.pagination.total, 4, "M1 verification=Manual -> 4 sessions");
  r = await get("/api/merchant/M1/sessions?start=2024-06-24");
  assertDeepEq(r.body.sessions.map((s) => s.session_key).sort(), ["s1", "s6"], "M1 start=2024-06-24");

  // sorting
  r = await get("/api/merchant/M2/sessions?sort=amount:asc");
  assertDeepEq(r.body.sessions.map((s) => s.session_key), ["s10", "s8", "s7", "s9"], "M2 sort=amount:asc");
  r = await get("/api/merchant/M2/sessions?sort=retry_count:desc");
  assertDeepEq(r.body.sessions.map((s) => s.session_key), ["s7", "s10", "s8", "s9"], "M2 sort=retry_count:desc (tie-break session_key asc)");

  // pagination
  r = await get("/api/merchant/M2/sessions?page=2&page_size=2");
  assertDeepEq(r.body.sessions.map((s) => s.session_key), ["s8", "s10"], "M2 sessions page2");
  assertEq(r.body.pagination.total_pages, 2, "M2 sessions total_pages = 2");

  // status validation
  r = await get("/api/merchant/M2/sessions?status=Exploded");
  assertEq(r.status, 400, "invalid status -> 400");
  assertEq(r.body.error.details.allowed.includes("NoAttempt"), true, "status error lists allowed values");

  // unknown merchant
  r = await get("/api/merchant/NO_SUCH_MERCHANT/sessions");
  assertEq(r.status, 404, "unknown merchant sessions -> 404");
  assertEq(r.body.error.code, "merchant_not_found", "404 code = merchant_not_found");
}

// ---------------------------------------------------------------------------
// 8. Session trace
// ---------------------------------------------------------------------------

async function testSessionTrace() {
  group("session trace");

  let r = await get("/api/session/s1");
  assertEq(r.status, 200, "s1 trace 200");
  assertEq(r.body.session.session_key, "s1", "s1 session_key");
  assertEq(r.body.session.merchant_key, "M1", "s1 merchant_key");
  assertEq(r.body.session.session_status, "Failed", "s1 session_status = Failed");
  assertEq(r.body.session.amount, 1000, "s1 amount = 1000");
  assertEq(r.body.session.attempt_count, 2, "s1 attempt_count = 2");
  assertEq(r.body.session.retry_count, 1, "s1 retry_count = 1");
  assertEq(r.body.session.try_seq_last, 2, "s1 try_seq_last = 2");
  assertEq(r.body.session.verify_type, "Automated", "s1 verify_type");

  assertEq(r.body.attempts.length, 2, "s1 attempts = 2");
  assertEq(r.body.attempts[0].try_seq, 1, "s1 attempt 1 try_seq = 1");
  assertEq(r.body.attempts[0].try_status, "Failed", "s1 attempt 1 try_status = Failed");
  assertEq(r.body.attempts[0].amount, 1000, "s1 attempt 1 amount (repeated across attempts)");
  assertEq(r.body.attempts[0].is_last_attempt, false, "s1 attempt 1 not last");
  assertEq(r.body.attempts[1].try_seq, 2, "s1 attempt 2 try_seq = 2");
  assertEq(r.body.attempts[1].is_last_attempt, true, "s1 attempt 2 is last");
  assertEq(r.body.attempts[1].raw.amount, 1000, "s1 attempt 2 raw row preserved");
  assertTrue(r.body.summary.includes("ended in Failed after 2 attempts"), "s1 summary mentions final state");

  if (MODE === "minimal") {
    assertEq(r.body.attempts[0].try_response_code, null, "try_response_code null when column absent");
    assertEq(r.body.session.verified_at, null, "verified_at null when column absent");
  } else {
    assertEq(r.body.attempts[0].try_response_code, "401", "s1 attempt 1 response code = 401");
    assertEq(r.body.attempts[0].psp, "psp_a", "s1 attempt 1 psp");
    assertEq(r.body.attempts[0].issuer_bank, "b1", "s1 attempt 1 issuer_bank");
    assertEq(r.body.attempts[1].try_response_code, "412", "s1 attempt 2 response code = 412");
    assertTrue(r.body.summary.includes("response code 412"), "s1 summary mentions last response code");
  }

  // NoAttempt session — session vs attempt state separation
  r = await get("/api/session/s6");
  assertEq(r.body.session.session_status, "NoAttempt", "s6 session_status = NoAttempt");
  assertEq(r.body.session.attempt_count, 0, "s6 attempt_count = 0");
  assertEq(r.body.attempts[0].try_seq, 0, "s6 attempt try_seq = 0");
  assertTrue(r.body.summary.includes("no payment attempts"), "s6 summary");

  // Verified session with lifecycle timestamps
  r = await get("/api/session/s3");
  assertEq(r.body.session.session_status, "Verified", "s3 session_status = Verified");
  assertEq(r.body.attempts[0].try_status, "Verified", "s3 attempt status = Verified");
  assertTrue(r.body.summary.includes("ended in Verified"), "s3 summary");
  if (MODE !== "minimal") {
    assertEq(r.body.session.verified_at, "2024-06-21 11:01:00", "s3 verified_at");
    assertEq(r.body.session.settled_at, "2024-06-21 11:02:00", "s3 settled_at");
  }

  // unknown session
  r = await get("/api/session/NO_SUCH_SESSION");
  assertEq(r.status, 404, "unknown session -> 404");
  assertEq(r.body.error.code, "session_not_found", "404 code = session_not_found");
}

// ---------------------------------------------------------------------------
// 9. SQL injection resistance
// ---------------------------------------------------------------------------

async function testInjection() {
  group("sql injection resistance");

  let r = await get("/api/merchants?sort=failed_value:desc;DROP%20TABLE%20payments");
  assertEq(r.status, 400, "sort injection -> 400");

  r = await get("/api/merchants?sort=failed_value)%3BDROP%20TABLE%20payments--");
  assertEq(r.status, 400, "sort paren injection -> 400");

  r = await get("/api/merchants?page_size=25%20OR%201=1");
  assertEq(r.status, 400, "page_size injection -> 400");

  r = await get("/api/merchant/M2/sessions?status=Failed%3BDROP%20TABLE%20payments");
  assertEq(r.status, 400, "status injection -> 400");

  r = await get("/api/merchants?category=cat_1%27%20OR%20%271%27=%271");
  assertEq(r.body.pagination.total, 0, "category quote-injection returns no rows (parameterized)");

  r = await get("/api/merchants?psp=x%27%20UNION%20SELECT%20session_key%20FROM%20payments--");
  assertEq(r.status, 200, "psp UNION injection -> 200 (parameterized)");
  assertEq(r.body.pagination.total, 0, "psp UNION injection returns no rows");

  r = await get("/api/merchant/M1%27--/summary");
  assertEq(r.status, 404, "path key injection -> 404");

  r = await get("/api/session/s1%3BDROP%20TABLE%20payments");
  assertEq(r.status, 404, "session path injection -> 404");

  // dataset still intact and fully queryable after injection attempts
  r = await get("/api/merchants");
  assertEq(r.body.pagination.total, 7, "payments table intact after injection attempts");
  r = await get("/api/session/s7");
  assertEq(r.body.session.attempt_count, 3, "s7 intact after injection attempts");
}

// ---------------------------------------------------------------------------
// 10. Cross-endpoint consistency (evidence drill-down)
// ---------------------------------------------------------------------------

async function testConsistency() {
  group("cross-endpoint consistency");

  const list = await get("/api/merchants?min_failed_value=100");
  const drill = await get("/api/merchant/M1/sessions?status=Failed");
  const failedValueSum = drill.body.sessions.reduce((sum, s) => sum + (s.session_status === "Failed" ? s.amount : 0), 0);
  assertEq(failedValueSum, 1500, "failed sessions list sums to merchant failed_value (session grain)");

  const retryDrill = await get("/api/merchant/M1/sessions?status=Failed&retry=true");
  const retryLossSum = retryDrill.body.sessions.reduce((sum, s) => sum + s.amount, 0);
  assertEq(retryLossSum, 1000, "retry-loss sessions list sums to merchant retry_loss_value");

  const summary = await get("/api/merchant/M1/summary");
  assertEq(summary.body.metrics.failed_value, 1500, "summary failed_value consistent");
  assertEq(list.body.merchants.find((m) => m.merchant_key === "M1").failed_value, 1500, "list failed_value consistent");
}

// ---------------------------------------------------------------------------
// Numeric-mode focused checks (epoch timestamps)
// ---------------------------------------------------------------------------

async function testNumericMode() {
  group("numeric created_at mode (epoch seconds)");

  let r = await get("/api/merchants");
  assertEq(r.status, 200, "merchants 200");
  assertEq(r.body.pagination.total, 7, "7 merchants total");
  assertDeepEq(
    r.body.merchants.map((m) => m.merchant_key),
    ["M2", "M3", "M1", "M5", "M4", "M6", "M7"],
    "default order identical to text mode"
  );
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M1").failed_value, 1500, "M1 failed_value = 1500");

  r = await get("/api/merchants?start=2024-06-24");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key).sort(), ["M1", "M2", "M3"], "date filter works in numeric mode");

  r = await get("/api/merchants?start=2024-06-01&end=2024-06-15");
  assertEq(r.body.pagination.total, 6, "date range filter works in numeric mode");

  r = await get("/api/merchants?sort=failed_value:asc");
  assertDeepEq(r.body.merchants.map((m) => m.merchant_key), ["M6", "M7", "M4", "M5", "M1", "M3", "M2"], "sorting works in numeric mode");

  const m1 = r.body.merchants.find((m) => m.merchant_key === "M1");
  assertClose(m1.last_7d_change, 100, 0.01, "last_7d_change works in numeric mode (window math on epochs)");

  const s1 = await get("/api/session/s1");
  assertEq(s1.status, 200, "session trace 200 in numeric mode");
  assertEq(s1.body.session.attempt_count, 2, "s1 attempt_count = 2 in numeric mode");
  assertTrue(typeof s1.body.attempts[0].try_created_at === "number", "attempt timestamps numeric in numeric mode");

  r = await get("/api/session/NO_SUCH_SESSION");
  assertEq(r.status, 404, "unknown session 404 in numeric mode");
}

// ---------------------------------------------------------------------------
// Minimal-mode focused checks (core columns only)
// ---------------------------------------------------------------------------

async function testMinimalMode() {
  group("minimal dataset (no optional evidence columns)");

  let r = await get("/api/merchants");
  assertEq(r.status, 200, "merchants 200");
  assertEq(r.body.pagination.total, 7, "7 merchants total");
  assertEq(r.body.merchants.find((m) => m.merchant_key === "M2").failed_value, 5250, "M2 failed_value = 5250");

  r = await get("/api/merchants?psp=psp_b");
  assertEq(r.status, 400, "psp filter rejected when column absent");
  assertEq(r.body.error.code, "invalid_parameter", "psp filter error code");

  r = await get("/api/merchant/M1/sessions");
  assertEq(r.status, 200, "M1 sessions 200");
  assertEq(r.body.sessions.find((s) => s.session_key === "s1").last_try_response_code, null, "last_try_response_code null");

  r = await get("/api/session/s7");
  assertEq(r.status, 200, "s7 trace 200");
  assertEq(r.body.session.attempt_count, 3, "s7 attempt_count = 3");
  assertEq(r.body.attempts[2].try_status, "Failed", "s7 attempt 3 try_status");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (MODE === "full") {
  await testMerchantsList();
  await testMerchantsSorting();
  await testMerchantsPagination();
  await testMerchantsFilters();
  await testMerchantsValidation();
  await testMerchantSummary();
  await testMerchantSessions();
  await testSessionTrace();
  await testInjection();
  await testConsistency();
} else if (MODE === "numeric") {
  await testNumericMode();
} else if (MODE === "minimal") {
  await testMinimalMode();
  await testMerchantsList();
  await testMerchantSummary();
  await testMerchantSessions();
  await testSessionTrace();
} else {
  console.error(`Unknown mode: ${MODE}`);
  process.exit(2);
}

console.log(`\n${passed} passed, ${failed} failed (mode: ${MODE})`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
}
process.exit(0);
