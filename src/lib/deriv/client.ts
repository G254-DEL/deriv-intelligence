import { DERIV_PUBLIC_WS_URL } from "./constants";
import { DerivNotConnectedError } from "./errors";
import type {
  ActiveSymbol,
  ActiveSymbolsRequest,
  ContractsForRequest,
  DerivConnectionStatus,
  ScannerSnapshot,
  TickHandler,
  TicksHistoryRequest,
  TicksSubscribeRequest,
  Unsubscribe,
} from "./types";

const CONNECTION_LABELS: Record<DerivConnectionStatus, string> = {
  not_connected: "Deriv Market Data: Not Connected",
  connecting: "Deriv Market Data: Connecting",
  connected: "Deriv Market Data: Connected",
};

/**
 * Market-data client for public Deriv streams.
 *
 * Planned methods (not live in this milestone):
 * - active_symbols
 * - contracts_for
 * - ticks
 * - ticks_history
 *
 * This class must not place trades, send tokens, or open a socket yet.
 */
export class DerivMarketDataClient {
  readonly publicEndpoint = DERIV_PUBLIC_WS_URL;
  private status: DerivConnectionStatus = "not_connected";

  getStatus(): DerivConnectionStatus {
    return this.status;
  }

  getConnectionLabel(): string {
    return CONNECTION_LABELS[this.status];
  }

  getScannerSnapshot(): ScannerSnapshot {
    return {
      status: this.status,
      connectionLabel: this.getConnectionLabel(),
      rows: [],
    };
  }

  async connect(): Promise<void> {
    throw new DerivNotConnectedError("connect");
  }

  disconnect(): void {
    this.status = "not_connected";
  }

  async getActiveSymbols(
    _request: ActiveSymbolsRequest = { active_symbols: "brief" },
  ): Promise<ActiveSymbol[]> {
    throw new DerivNotConnectedError("active_symbols");
  }

  async getContractsFor(_request: ContractsForRequest): Promise<unknown> {
    throw new DerivNotConnectedError("contracts_for");
  }

  subscribeTicks(
    _request: TicksSubscribeRequest,
    _onTick: TickHandler,
  ): Unsubscribe {
    throw new DerivNotConnectedError("ticks");
  }

  async getTicksHistory(_request: TicksHistoryRequest): Promise<unknown> {
    throw new DerivNotConnectedError("ticks_history");
  }
}

export const derivMarketData = new DerivMarketDataClient();
