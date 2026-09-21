/**
 * Public Deriv WebSocket endpoint for market-data only.
 * No authentication, tokens, or trading methods are used on this channel.
 */
export const DERIV_PUBLIC_WS_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

export const DERIV_MARKET_DATA_METHODS = [
  "active_symbols",
  "contracts_for",
  "ticks",
  "ticks_history",
] as const;

export type DerivMarketDataMethod = (typeof DERIV_MARKET_DATA_METHODS)[number];

export const MARKET_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "synthetic_index", label: "Synthetics" },
  { id: "forex", label: "Forex" },
  { id: "indices", label: "Stock Indices" },
  { id: "commodities", label: "Commodities" },
  { id: "cryptocurrency", label: "Cryptocurrencies" },
] as const;

export type MarketCategoryId = (typeof MARKET_CATEGORIES)[number]["id"];

export const MAX_LIVE_TICK_STREAMS = 1000;
export const TICK_STALE_AFTER_MS = 8000;

