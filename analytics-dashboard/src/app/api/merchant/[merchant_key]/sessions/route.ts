import { NextRequest } from "next/server";
import { apiError, handleRouteError, jsonOk, paginationMeta } from "@/api/http";
import {
  ParamError,
  parseBoolean,
  parseDateRange,
  parseNonNegativeInt,
  parsePage,
  parsePageSize,
  parsePathKey,
  parseSort,
  parseStatuses,
  parseVerification,
} from "@/api/params";
import {
  DEFAULT_SESSION_SORT,
  queryMerchantSessions,
  SESSION_SORT_FIELDS,
} from "@/data/api-queries";
import type { MerchantSessionsResponse } from "@/types/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/merchant/:merchant_key/sessions
 * Session-grain evidence list for a merchant with server-side filtering,
 * sorting and pagination (OpenSpec/07 — Merchant Investigation evidence list).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchant_key: string }> }
) {
  try {
    const { merchant_key } = await params;
    const key = parsePathKey(merchant_key, "merchant_key");
    const params2 = request.nextUrl.searchParams;

    const { start, end } = parseDateRange(params2);
    const status = parseStatuses(params2);
    const retry = parseBoolean(params2, "retry");
    const verification = parseVerification(params2);
    const minAmount = parseNonNegativeInt(params2, "min_amount");
    const maxAmount = parseNonNegativeInt(params2, "max_amount");
    const sort = parseSort(params2, SESSION_SORT_FIELDS, DEFAULT_SESSION_SORT);
    const page = parsePage(params2);
    const pageSize = parsePageSize(params2, 50);

    if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
      throw new ParamError("min_amount", "min_amount is greater than max_amount");
    }

    const result = queryMerchantSessions(
      key,
      {
        start,
        end,
        status,
        retry,
        verification,
        min_amount: minAmount,
        max_amount: maxAmount,
      },
      sort,
      page,
      pageSize
    );

    if (!result) {
      return apiError(
        404,
        "merchant_not_found",
        `No merchant found with merchant_key "${key}".`
      );
    }

    const body: MerchantSessionsResponse = {
      merchant: result.merchant,
      sessions: result.rows,
      pagination: paginationMeta(page, pageSize, result.total),
      sort,
      filters: {
        start,
        end,
        status,
        retry,
        verification,
        min_amount: minAmount,
        max_amount: maxAmount,
      },
    };

    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
