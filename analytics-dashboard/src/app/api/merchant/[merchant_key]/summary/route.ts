import { NextRequest } from "next/server";
import { apiError, handleRouteError, jsonOk } from "@/api/http";
import { parsePathKey } from "@/api/params";
import { getMerchantSummary } from "@/data/api-queries";
import type { MerchantSummaryResponse } from "@/types/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/merchant/:merchant_key/summary
 * Merchant investigation metrics: session-grain KPIs, outcome mix, category
 * benchmark, verification-mode diagnostics, PSP/terminal risk clusters and
 * evidence links to the composing sessions (OpenSpec/03, OpenSpec/07).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchant_key: string }> }
) {
  try {
    const { merchant_key } = await params;
    const key = parsePathKey(merchant_key, "merchant_key");

    const result = getMerchantSummary(key);
    if (!result) {
      return apiError(
        404,
        "merchant_not_found",
        `No merchant found with merchant_key "${key}".`
      );
    }

    const body: MerchantSummaryResponse = {
      merchant: result.merchant,
      metrics: result.metrics,
      outcome_mix: {
        entries: result.outcomeMix,
        other_sessions: result.otherSessions,
      },
      verification_modes: result.verificationModes,
      psp_clusters: result.pspClusters,
      terminal_clusters: result.terminalClusters,
      evidence: {
        links: result.evidenceLinks,
        top_failed_sessions: result.topFailedSessions,
        top_retry_loss_sessions: result.topRetryLossSessions,
      },
    };

    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
