import type { MarketCategoryId } from "./constants";
import type { DerivActiveSymbol } from "./types";

const MARKET_CATEGORY_BY_API_VALUE: Record<string, MarketCategoryId> = {
  forex: "forex",
  indices: "indices",
  stock_indices: "indices",
  commodities: "commodities",
  cryptocurrency: "cryptocurrency",
  crypto: "cryptocurrency",
  synthetic_index: "synthetic_index",
  synthetics: "synthetic_index",
  synthetic: "synthetic_index",
};

/**
 * Maps API market fields onto scanner category buttons.
 * Returns null when the payload does not identify a known category.
 */
export function classifyMarketCategory(
  symbol: DerivActiveSymbol,
): MarketCategoryId | null {
  const candidates = [symbol.market, symbol.underlying_symbol_type];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const mapped = MARKET_CATEGORY_BY_API_VALUE[candidate.toLowerCase().trim()];
    if (mapped) {
      return mapped;
    }
  }

  return null;
}
