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

const EXCLUDED_SYMBOL_PREFIXES = ["frx", "otc_", "wld", "cry"];

/**
 * Digit scanner markets only. Forex, OTC indices, baskets, and other
 * non-synthetic symbols error on the public tick stream and are omitted.
 */
export function isPublicDigitMarket(symbol: DerivActiveSymbol): boolean {
  const code = symbol.underlying_symbol.trim();
  if (!code) {
    return false;
  }

  const lower = code.toLowerCase();
  if (EXCLUDED_SYMBOL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return false;
  }

  if (symbol.category && symbol.category !== "synthetic_index") {
    return false;
  }

  if (symbol.category === "synthetic_index") {
    return true;
  }

  return /^(r_|1hz|boom|crash|jd|vol|stprng)/i.test(code);
}
