import { NextRequest } from "next/server";
import { handleRouteError, jsonOk, paginationMeta } from "@/api/http";
import {
  ParamError,
  parseDateRange,
  parseNonNegativeInt,
  parsePage,
  parsePageSize,
  parsePercent,
  parseSort,
  parseStringParam,
  parseVerification,
} from "@/api/params";
import {
  DEFAULT_MERCHANT_SORT,
  MERCHANT_SORT_FIELDS,
  queryMerchants,
} from "@/data/api-queries";
import type { MerchantListResponse } from "@/types/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/merchants
 * Merchant triage list with server-side filtering, multi-column sorting and
 * pagination (see OpenSpec/07 — Merchant Triage table).
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const { start, end } = parseDateRange(params);
    const category = parseStringParam(params, "category", 200);
    const verification = parseVerification(params);
    const psp = parseStringParam(params, "psp", 200);
    const terminal = parseStringParam(params, "terminal", 200);
    const minAmount = parseNonNegativeInt(params, "min_amount");
    const maxAmount = parseNonNegativeInt(params, "max_amount");
    const minFailedValue = parseNonNegativeInt(params, "min_failed_value");
    const minRetryLossValue = parseNonNegativeInt(params, "min_retry_loss_value");
    const minRetryShare = parsePercent(params, "min_retry_share");
    const sort = parseSort(params, MERCHANT_SORT_FIELDS, DEFAULT_MERCHANT_SORT);
    const page = parsePage(params);
    const pageSize = parsePageSize(params, 25);

    if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
      throw new ParamError("min_amount", "min_amount is greater than max_amount");
    }

    const result = queryMerchants(
      {
        start,
        end,
        category,
        verification,
        psp,
        terminal,
        min_amount: minAmount,
        max_amount: maxAmount,
        min_failed_value: minFailedValue,
        min_retry_loss_value: minRetryLossValue,
        min_retry_share: minRetryShare,
      },
      sort,
      page,
      pageSize
    );

    const body: MerchantListResponse = {
      merchants: result.rows,
      pagination: paginationMeta(page, pageSize, result.total),
      sort,
      filters: {
        start,
        end,
        category,
        verification,
        psp,
        terminal,
        min_amount: minAmount,
        max_amount: maxAmount,
        min_failed_value: minFailedValue,
        min_retry_loss_value: minRetryLossValue,
        min_retry_share: minRetryShare,
      },
    };

    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
