import { NextRequest } from "next/server";
import { apiError, handleRouteError, jsonOk } from "@/api/http";
import { parsePathKey } from "@/api/params";
import { getSessionDetail } from "@/data/api-queries";
import type { SessionDetailResponse } from "@/types/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/session/:session_key
 * Full attempt-level trace for a single session, preserving the distinction
 * between final session status and per-attempt status (OpenSpec/04, OpenSpec/07).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ session_key: string }> }
) {
  try {
    const { session_key } = await params;
    const key = parsePathKey(session_key, "session_key");

    const result = getSessionDetail(key);
    if (!result) {
      return apiError(
        404,
        "session_not_found",
        `No session found with session_key "${key}".`
      );
    }

    const body: SessionDetailResponse = {
      session: result.session,
      attempts: result.attempts,
      summary: result.summary,
    };

    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
