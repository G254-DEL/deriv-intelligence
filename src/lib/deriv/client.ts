import { DERIV_PUBLIC_WS_URL } from "./constants";
import { DerivNotConnectedError } from "./errors";
import {
  PublicMarketDataClient,
  connectionLabel,
} from "./public-market-data";
import type {
  ActiveSymbol,
  ActiveSymbolsRequest,
  ContractsForRequest,
  DerivActiveSymbol,
  DerivConnectionState,
  DerivConnectionStatus,
  ScannerRow,
  ScannerSnapshot,
  TickHandler,
  TicksHistoryRequest,
  TicksSubscribeRequest,
  Unsubscribe,
} from "./types";

export function mapConnectionStatus(
  state: DerivConnectionState,
): DerivConnectionStatus {
  if (state === "disconnected") {
    return "not_connected";
  }
  return state;
}

/**
 * Browser-safe public market-data client.
 * Uses the existing unauthenticated WebSocket implementation.
 * Does not send tokens, authorize, or place orders.
 */
export class DerivMarketDataClient {
  readonly publicEndpoint = DERIV_PUBLIC_WS_URL;
  private inner: PublicMarketDataClient;
  private readonly owned: boolean;
  private readonly tickUnsubscribers = new Set<Unsubscribe>();

  constructor(inner?: PublicMarketDataClient) {
    if (inner) {
      this.inner = inner;
      this.owned = false;
    } else {
      this.inner = new PublicMarketDataClient();
      this.owned = true;
    }
  }

  getStatus(): DerivConnectionStatus {
    return mapConnectionStatus(this.inner.getState());
  }

  getConnectionLabel(): string {
    return connectionLabel(this.inner.getState());
  }

  getScannerSnapshot(): ScannerSnapshot {
    const ticks = this.inner.getLatestTicks();
    const rows: ScannerRow[] = this.inner.getCachedSymbols().map((symbol) => {
      const tick = ticks.get(symbol.underlying_symbol);
      return toScannerRow(symbol, tick?.formattedPrice ?? null, tick?.digit ?? null, tick?.status ?? "connecting");
    });

    return {
      status: this.getStatus(),
      connectionLabel: this.getConnectionLabel(),
      rows,
    };
  }

  async connect(): Promise<void> {
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this environment.");
    }

    this.inner.connect();
    await this.inner.waitForConnected();
  }

  disconnect(): void {
    for (const unsubscribe of this.tickUnsubscribers.values()) {
      unsubscribe();
    }
    this.tickUnsubscribers.clear();

    if (this.owned) {
      this.inner.disconnect();
    }
  }

  async getActiveSymbols(
    request: ActiveSymbolsRequest = { active_symbols: "brief" },
  ): Promise<ActiveSymbol[]> {
    this.assertConnected("active_symbols");
    const symbols = await this.inner.fetchActiveSymbols(request.active_symbols);
    return symbols.map(toActiveSymbol);
  }

  async getContractsFor(request: ContractsForRequest): Promise<unknown> {
    this.assertConnected("contracts_for");
    return this.inner.requestContractsFor(request);
  }

  subscribeTicks(
    request: TicksSubscribeRequest,
    onTick: TickHandler,
  ): Unsubscribe {
    this.assertConnected("ticks");
    const unsubscribe = this.inner.subscribeSymbolTicks(request.ticks, onTick);
    const wrapped: Unsubscribe = () => {
      unsubscribe();
      this.tickUnsubscribers.delete(wrapped);
    };
    this.tickUnsubscribers.add(wrapped);
    return wrapped;
  }

  async getTicksHistory(request: TicksHistoryRequest): Promise<unknown> {
    this.assertConnected("ticks_history");
    return this.inner.requestTicksHistory(request);
  }

  private assertConnected(method: string): void {
    if (this.getStatus() !== "connected") {
      throw new DerivNotConnectedError(method);
    }
  }
}

function toActiveSymbol(symbol: DerivActiveSymbol): ActiveSymbol {
  return {
    symbol: symbol.underlying_symbol,
    display_name: symbol.underlying_symbol_name ?? symbol.underlying_symbol,
    market: symbol.market ?? "",
    market_display_name: symbol.market ?? "",
    submarket: symbol.submarket,
    pip: symbol.pip_size,
  };
}

function toScannerRow(
  symbol: DerivActiveSymbol,
  currentPrice: string | null,
  currentDigit: string | null,
  tickStatus: string,
): ScannerRow {
  return {
    market: symbol.market ?? "",
    symbol: symbol.underlying_symbol,
    marketCategory: symbol.category ?? "all",
    currentPrice,
    currentDigit,
    tickStatus,
    strategy: "Digit Bias",
    entryState: "COLLECTING",
  };
}

export const derivMarketData = new DerivMarketDataClient();
