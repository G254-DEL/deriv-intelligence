import type { MarketCategoryId } from "./constants";

export type DerivConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type DerivActiveSymbol = {
  underlying_symbol: string;
  underlying_symbol_name?: string;
  underlying_symbol_type?: string;
  market?: string;
  submarket?: string;
  pip_size?: number;
  exchange_is_open?: number;
  is_trading_suspended?: number;
  category?: MarketCategoryId | null;
};

export type DerivTick = {
  symbol: string;
  quote: number | string;
  epoch: number;
  pip_size?: number;
  id?: string;
};

export type MarketTickStatus =
  | "connecting"
  | "live"
  | "stale"
  | "error";

export type MarketTickSnapshot = {
  symbol: string;
  quote: number | string;
  formattedPrice: string;
  digit: string;
  epoch: number;
  id?: string;
  status: MarketTickStatus;
  receivedAt: number;
};

export type DerivConnectionStatus = "not_connected" | "connecting" | "connected";

export type ActiveSymbolsRequest = {
  active_symbols: "brief" | "full";
  product_type?: "basic";
};

export type ActiveSymbol = {
  symbol: string;
  display_name: string;
  market: string;
  market_display_name: string;
  submarket?: string;
  pip?: number;
};

export type ContractsForRequest = {
  contracts_for: string;
  product_type?: "basic";
};

export type Tick = {
  symbol: string;
  quote: number;
  epoch: number;
};

export type TicksSubscribeRequest = {
  ticks: string;
  subscribe: 1;
};

export type TicksHistoryRequest = {
  ticks_history: string;
  end: "latest" | string;
  start?: number;
  count?: number;
  style?: "ticks";
};

export type ScannerRow = {
  market: string;
  symbol: string;
  marketCategory: MarketCategoryId;
  currentPrice: string | null;
  currentDigit: string | null;
  tickStatus: string;
  strategy: string;
  entryState: string;
};

export type ScannerSnapshot = {
  status: DerivConnectionStatus;
  connectionLabel: string;
  rows: ScannerRow[];
};

export type TickHandler = (tick: Tick) => void;
export type Unsubscribe = () => void;
