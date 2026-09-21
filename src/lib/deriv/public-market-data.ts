import { DERIV_PUBLIC_WS_URL, MAX_LIVE_TICK_STREAMS, TICK_STALE_AFTER_MS } from "./constants";
import { classifyMarketCategory } from "./classify-market";
import { TickHistoryStore } from "./tick-history";
import {
  decimalPlacesFromPipSize,
  extractLastDisplayedDigit,
} from "../digits/extract-last-digit";
import type {
  DerivActiveSymbol,
  DerivConnectionState,
  DerivTick,
  MarketTickSnapshot,
  MarketTickStatus,
} from "./types";

export type PublicMarketDataHandlers = {
  onConnectionChange?: (
    state: DerivConnectionState,
    detail?: string,
  ) => void;
  onActiveSymbols?: (symbols: DerivActiveSymbol[]) => void;
  onTick?: (tick: DerivTick) => void;
  onMarketTick?: (snapshot: MarketTickSnapshot) => void;
  onTickStatus?: (
    symbol: string,
    status: MarketTickStatus,
    detail?: string,
  ) => void;
  onError?: (message: string) => void;
};

type JsonRecord = Record<string, unknown>;

type TickSubscription = {
  id: string | null;
  pendingForget: boolean;
  lastTickAt: number | null;
  status: MarketTickStatus;
};

const ACTIVE_SYMBOLS_REQUEST = {
  active_symbols: "brief",
} as const;

const SESSION_RELEASE_DELAY_MS = 400;

function derivLog(message: string, extra?: unknown): void {
  if (extra !== undefined) {
    console.info(message, extra);
  } else {
    console.info(message);
  }
}

export class PublicMarketDataClient {
  readonly endpoint = DERIV_PUBLIC_WS_URL;

  private socket: WebSocket | null = null;
  private state: DerivConnectionState = "disconnected";
  private detail: string | undefined;
  private reqId = 1;
  private handlers: PublicMarketDataHandlers;
  private generation = 0;
  private closedIntentionally = false;
  private cachedSymbols: DerivActiveSymbol[] = [];
  private readonly tickHistory = new TickHistoryStore();
  private readonly subscriptions = new Map<string, TickSubscription>();
  private readonly latestTicks = new Map<string, MarketTickSnapshot>();
  private desiredSymbols: string[] = [];
  private staleTimer: number | null = null;

  constructor(handlers: PublicMarketDataHandlers = {}) {
    this.handlers = handlers;
  }

  setHandlers(handlers: PublicMarketDataHandlers): void {
    this.handlers = handlers;
    this.replayCurrentState();
  }

  getState(): DerivConnectionState {
    return this.state;
  }

  getWatchedSymbol(): string | null {
    return this.desiredSymbols[0] ?? null;
  }

  getTickHistory(symbol: string) {
    return this.tickHistory.get(symbol);
  }

  connect(): void {
    if (typeof WebSocket === "undefined") {
      this.setState("error", "WebSocket is not available in this environment.");
      return;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      this.replayCurrentState();
      return;
    }

    this.closedIntentionally = false;
    this.generation += 1;
    const generation = this.generation;

    this.setState("connecting");
    derivLog("[Deriv] Connecting...", this.endpoint);

    try {
      const socket = new WebSocket(this.endpoint);
      this.socket = socket;
      socket.onopen = () => {
        if (generation !== this.generation) {
          return;
        }
        this.handleOpen();
      };
      socket.onmessage = (event: MessageEvent) => {
        if (generation !== this.generation) {
          return;
        }
        void this.handleMessage(event);
      };
      socket.onerror = () => {
        if (generation !== this.generation) {
          return;
        }
        this.handleSocketError();
      };
      socket.onclose = (event: CloseEvent) => {
        if (generation !== this.generation) {
          return;
        }
        this.handleClose(event);
      };
    } catch (error) {
      this.setState(
        "error",
        error instanceof Error ? error.message : "Failed to open WebSocket.",
      );
    }
  }

  requestActiveSymbols(): void {
    derivLog("[Deriv] Requesting active symbols...");
    this.send({
      ...ACTIVE_SYMBOLS_REQUEST,
      req_id: this.nextReqId(),
    });
  }

  subscribeTicks(symbol: string): void {
    const next = this.desiredSymbols.filter((item) => item !== symbol);
    next.unshift(symbol);
    this.setTickSubscriptions(next.slice(0, MAX_LIVE_TICK_STREAMS));
  }

  setTickSubscriptions(symbols: string[]): void {
    const unique: string[] = [];
    for (const raw of symbols) {
      const symbol = raw.trim();
      if (!symbol || unique.includes(symbol)) {
        continue;
      }
      unique.push(symbol);
      if (unique.length >= MAX_LIVE_TICK_STREAMS) {
        break;
      }
    }

    this.desiredSymbols = unique;

    for (const [symbol] of this.subscriptions) {
      if (!unique.includes(symbol)) {
        this.forgetSymbol(symbol);
      }
    }

    if (!this.canSend()) {
      return;
    }

    for (const symbol of unique) {
      if (!this.subscriptions.has(symbol)) {
        this.requestTickStream(symbol);
      }
    }

    this.ensureStaleTimer();
  }

  unsubscribeTicks(): void {
    this.setTickSubscriptions([]);
  }

  private requestTickStream(symbol: string): void {
    this.subscriptions.set(symbol, {
      id: null,
      pendingForget: false,
      lastTickAt: null,
      status: "connecting",
    });
    this.handlers.onTickStatus?.(symbol, "connecting");
    derivLog("[Deriv] Tick subscription requested:", symbol);
    this.send({
      ticks: symbol,
      subscribe: 1,
      req_id: this.nextReqId(),
      passthrough: { scanner_symbol: symbol },
    });
  }

  private forgetSymbol(symbol: string): void {
    const subscription = this.subscriptions.get(symbol);
    if (!subscription) {
      return;
    }

    if (subscription.id && this.canSend()) {
      this.send({
        forget: subscription.id,
        req_id: this.nextReqId(),
      });
      this.subscriptions.delete(symbol);
      return;
    }

    subscription.pendingForget = true;
    this.subscriptions.set(symbol, subscription);
  }

  disconnect(): void {
    this.closedIntentionally = true;
    this.generation += 1;
    this.stopStaleTimer();
    const socket = this.socket;

    if (socket && this.canSend() && this.subscriptions.size > 0) {
      this.send({
        forget_all: "ticks",
        req_id: this.nextReqId(),
      });
    }

    this.subscriptions.clear();
    this.desiredSymbols = [];

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    }

    this.socket = null;
    this.setState("disconnected");
  }

  private replayCurrentState(): void {
    this.handlers.onConnectionChange?.(this.state, this.detail);
    if (this.cachedSymbols.length > 0) {
      this.handlers.onActiveSymbols?.(this.cachedSymbols);
    }
    for (const snapshot of this.latestTicks.values()) {
      this.handlers.onMarketTick?.(snapshot);
      this.handlers.onTickStatus?.(snapshot.symbol, snapshot.status);
    }
  }

  private handleOpen(): void {
    derivLog("[Deriv] Connected");
    this.setState("connected");
    this.requestActiveSymbols();
    if (this.desiredSymbols.length > 0) {
      this.setTickSubscriptions(this.desiredSymbols);
    }
    this.ensureStaleTimer();
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const rawText = await readMessageText(event.data);
    if (rawText === null) {
      const message = "Malformed market-data message received.";
      derivLog("[Deriv] WebSocket error", message);
      this.handlers.onError?.(message);
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      const message = "Malformed market-data message received.";
      derivLog("[Deriv] WebSocket error", message);
      this.handlers.onError?.(message);
      return;
    }

    if (!isRecord(payload)) {
      const message = "Malformed market-data message received.";
      derivLog("[Deriv] WebSocket error", message);
      this.handlers.onError?.(message);
      return;
    }

    const apiError = readApiError(payload);
    if (apiError) {
      const failedSymbol = readFailedTickSymbol(payload);
      if (failedSymbol) {
        derivLog("[Deriv] Tick subscription error:", `${failedSymbol}: ${apiError}`);
        const subscription = this.subscriptions.get(failedSymbol);
        if (subscription) {
          subscription.status = "error";
          this.subscriptions.set(failedSymbol, subscription);
        }
        this.handlers.onTickStatus?.(failedSymbol, "error", apiError);
        return;
      }
      derivLog("[Deriv] WebSocket error", apiError);
      this.handlers.onError?.(apiError);
      return;
    }

    if (isPing(payload)) {
      this.send({ pong: 1 });
      return;
    }

    const activeSymbolsPayload = findActiveSymbols(payload);
    if (activeSymbolsPayload !== undefined) {
      const symbols = parseActiveSymbols(activeSymbolsPayload);
      this.cachedSymbols = symbols;
      derivLog("[Deriv] Received active symbols", { count: symbols.length });
      if (symbols.length === 0) {
        derivLog("[Deriv] WebSocket error", {
          reason: "Active-symbol list was empty or could not be parsed.",
          keys: Object.keys(payload),
        });
      }
      this.handlers.onActiveSymbols?.(symbols);
      return;
    }

    const msgType = typeof payload.msg_type === "string" ? payload.msg_type : "";

    if (msgType === "tick" || isRecord(payload.tick)) {
      const tick = parseTick(payload.tick);
      if (!tick) {
        const message = "Malformed tick message received.";
        derivLog("[Deriv] Tick subscription error:", message);
        this.handlers.onError?.(message);
        return;
      }

      const subscriptionId = readSubscriptionId(payload) ?? tick.id ?? null;
      let subscription = this.subscriptions.get(tick.symbol);

      if (!subscription && subscriptionId) {
        for (const [symbol, item] of this.subscriptions) {
          if (item.id === subscriptionId || (item.id === null && this.desiredSymbols.includes(tick.symbol))) {
            subscription = item;
            this.subscriptions.delete(symbol);
            this.subscriptions.set(tick.symbol, item);
            break;
          }
        }
      }

      if (subscription) {
        if (subscriptionId) {
          subscription.id = subscriptionId;
        }
        if (subscription.pendingForget || !this.desiredSymbols.includes(tick.symbol)) {
          this.forgetSymbol(tick.symbol);
          return;
        }
        subscription.lastTickAt = Date.now();
        subscription.status = "live";
        this.subscriptions.set(tick.symbol, subscription);
      } else if (!this.desiredSymbols.includes(tick.symbol)) {
        if (subscriptionId) {
          this.send({
            forget: subscriptionId,
            req_id: this.nextReqId(),
          });
        }
        return;
      }

      const snapshot = this.toSnapshot(tick, "live");
      this.latestTicks.set(tick.symbol, snapshot);
      this.tickHistory.push({
        symbol: tick.symbol,
        quote: tick.quote,
        formattedQuote: snapshot.formattedPrice,
        epoch: tick.epoch,
        digit: snapshot.digit,
        id: tick.id,
      });

      derivLog("[Deriv] Tick received:", tick.symbol);
      derivLog("[Deriv] Current price:", snapshot.formattedPrice);
      derivLog("[Deriv] Current digit:", snapshot.digit);

      this.handlers.onTick?.(tick);
      this.handlers.onMarketTick?.(snapshot);
      this.handlers.onTickStatus?.(tick.symbol, "live");
    }
  }

  private handleSocketError(): void {
    derivLog("[Deriv] WebSocket error");
    this.setState("error", "WebSocket connection failure.");
  }

  private handleClose(event: CloseEvent): void {
    derivLog("[Deriv] WebSocket closed", {
      code: event.code,
      reason: event.reason || "(none)",
      intentional: this.closedIntentionally,
    });

    this.socket = null;
    this.subscriptions.clear();
    this.stopStaleTimer();

    if (this.closedIntentionally) {
      this.setState("disconnected");
      return;
    }

    const detail = event.reason
      ? `WebSocket closed (${event.code}: ${event.reason})`
      : `WebSocket closed (${event.code})`;

    if (this.state === "connecting" || this.state === "error") {
      this.setState("error", detail);
      return;
    }

    this.setState("disconnected", detail);

    window.setTimeout(() => {
      if (!this.closedIntentionally) {
        this.connect();
      }
    }, 2000);
  }

  private send(body: JsonRecord): void {
    if (!this.canSend() || !this.socket) {
      if (!this.closedIntentionally) {
        derivLog("[Deriv] WebSocket error", "Cannot send because the socket is not open.");
      }
      return;
    }

    this.socket.send(JSON.stringify(body));
  }

  private canSend(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private nextReqId(): number {
    this.reqId += 1;
    return this.reqId;
  }

  private setState(state: DerivConnectionState, detail?: string): void {
    this.state = state;
    this.detail = detail;
    this.handlers.onConnectionChange?.(state, detail);
    if (state === "error" && detail) {
      this.handlers.onError?.(detail);
    }
  }

  private toSnapshot(tick: DerivTick, status: MarketTickStatus): MarketTickSnapshot {
    const symbolMeta = this.cachedSymbols.find(
      (item) => item.underlying_symbol === tick.symbol,
    );
    const decimalPlaces =
      decimalPlacesFromPipSize(tick.pip_size ?? Number.NaN) ??
      decimalPlacesFromPipSize(symbolMeta?.pip_size ?? Number.NaN);
    const extracted = extractLastDisplayedDigit(tick.quote, decimalPlaces);

    return {
      symbol: tick.symbol,
      quote: tick.quote,
      formattedPrice: extracted?.formatted ?? String(tick.quote),
      digit: extracted?.digit ?? "—",
      epoch: tick.epoch,
      id: tick.id,
      status,
      receivedAt: Date.now(),
    };
  }

  private ensureStaleTimer(): void {
    if (this.staleTimer !== null || typeof window === "undefined") {
      return;
    }

    this.staleTimer = window.setInterval(() => {
      this.markStaleStreams();
    }, 1000);
  }

  private stopStaleTimer(): void {
    if (this.staleTimer !== null && typeof window !== "undefined") {
      window.clearInterval(this.staleTimer);
    }
    this.staleTimer = null;
  }

  private markStaleStreams(): void {
    const now = Date.now();
    for (const [symbol, subscription] of this.subscriptions) {
      if (
        subscription.status !== "live" ||
        subscription.lastTickAt === null ||
        now - subscription.lastTickAt < TICK_STALE_AFTER_MS
      ) {
        continue;
      }

      subscription.status = "stale";
      this.subscriptions.set(symbol, subscription);
      const latest = this.latestTicks.get(symbol);
      if (latest) {
        const staleSnapshot = { ...latest, status: "stale" as const };
        this.latestTicks.set(symbol, staleSnapshot);
        this.handlers.onMarketTick?.(staleSnapshot);
      }
      derivLog("[Deriv] Tick stream stale:", symbol);
      this.handlers.onTickStatus?.(symbol, "stale");
    }
  }
}

let sharedClient: PublicMarketDataClient | null = null;
let sharedRefs = 0;
let sharedReleaseTimer: number | null = null;

/**
 * Keeps one public market-data socket across React Strict Mode’s
 * immediate unmount/remount so the connection is not closed before it opens.
 */
export function retainPublicMarketData(
  handlers: PublicMarketDataHandlers,
): { client: PublicMarketDataClient; release: () => void } {
  if (typeof window !== "undefined" && sharedReleaseTimer !== null) {
    window.clearTimeout(sharedReleaseTimer);
    sharedReleaseTimer = null;
  }

  if (!sharedClient) {
    sharedClient = new PublicMarketDataClient(handlers);
    sharedClient.connect();
  } else {
    sharedClient.setHandlers(handlers);
    sharedClient.connect();
  }

  const client = sharedClient;
  sharedRefs += 1;

  return {
    client,
    release: () => {
      sharedRefs = Math.max(0, sharedRefs - 1);
      if (sharedRefs > 0 || !sharedClient) {
        return;
      }

      const session = sharedClient;
      if (typeof window === "undefined") {
        session.disconnect();
        sharedClient = null;
        return;
      }

      sharedReleaseTimer = window.setTimeout(() => {
        sharedReleaseTimer = null;
        if (sharedRefs === 0 && sharedClient === session) {
          session.disconnect();
          sharedClient = null;
        }
      }, SESSION_RELEASE_DELAY_MS);
    },
  };
}

export function connectionLabel(state: DerivConnectionState): string {
  switch (state) {
    case "connected":
      return "Deriv Market Data: Connected";
    case "connecting":
      return "Deriv Market Data: Connecting";
    case "error":
      return "Deriv Market Data: Error";
    default:
      return "Deriv Market Data: Disconnected";
  }
}

export function parseActiveSymbols(value: unknown): DerivActiveSymbol[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const symbols: DerivActiveSymbol[] = [];

  for (const item of value) {
    const parsed = parseActiveSymbol(item);
    if (parsed) {
      symbols.push(parsed);
    }
  }

  return symbols;
}

export function parseActiveSymbol(value: unknown): DerivActiveSymbol | null {
  if (!isRecord(value)) {
    return null;
  }

  const underlyingSymbol =
    readString(value.underlying_symbol) ?? readString(value.symbol);

  if (!underlyingSymbol) {
    return null;
  }

  const pipSize = readNumber(value.pip_size) ?? readNumber(value.pip);

  return {
    underlying_symbol: underlyingSymbol,
    underlying_symbol_name:
      readString(value.underlying_symbol_name) ?? readString(value.display_name),
    underlying_symbol_type: readString(value.underlying_symbol_type),
    market: readString(value.market),
    submarket: readString(value.submarket),
    pip_size: pipSize,
    exchange_is_open: readNumber(value.exchange_is_open),
    is_trading_suspended: readNumber(value.is_trading_suspended),
    category: classifyMarketCategory({
      underlying_symbol: underlyingSymbol,
      underlying_symbol_type: readString(value.underlying_symbol_type),
      market: readString(value.market),
    }),
  };
}

export function parseTick(value: unknown): DerivTick | null {
  if (!isRecord(value)) {
    return null;
  }

  const symbol = readString(value.symbol) ?? readString(value.underlying_symbol);
  const quote = readQuote(value.quote);
  const epoch = readNumber(value.epoch);

  if (!symbol || quote === null || epoch === undefined) {
    return null;
  }

  return {
    symbol,
    quote,
    epoch,
    pip_size: readNumber(value.pip_size),
    id: readString(value.id),
  };
}

function findActiveSymbols(payload: JsonRecord): unknown {
  if (Array.isArray(payload.active_symbols)) {
    return payload.active_symbols;
  }

  if (isRecord(payload.data) && Array.isArray(payload.data.active_symbols)) {
    return payload.data.active_symbols;
  }

  return undefined;
}

async function readMessageText(data: unknown): Promise<string | null> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.text();
  }

  return null;
}

function readFailedTickSymbol(payload: JsonRecord): string | undefined {
  if (!isRecord(payload.echo_req)) {
    return undefined;
  }

  return (
    readString(payload.echo_req.ticks) ??
    (isRecord(payload.echo_req.passthrough)
      ? readString(payload.echo_req.passthrough.scanner_symbol)
      : undefined)
  );
}

function readSubscriptionId(payload: JsonRecord): string | null {
  if (!isRecord(payload.subscription)) {
    return null;
  }

  return readString(payload.subscription.id) ?? null;
}

function readApiError(payload: JsonRecord): string | null {
  if (isRecord(payload.error)) {
    return (
      readString(payload.error.message) ??
      readString(payload.error.code) ??
      "Deriv returned an error."
    );
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first = payload.errors[0];
    if (isRecord(first)) {
      return (
        readString(first.message) ??
        readString(first.code) ??
        "Deriv returned an error."
      );
    }
  }

  return null;
}

function isPing(payload: JsonRecord): boolean {
  return payload.msg_type === "ping" || "ping" in payload;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function readQuote(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return value;
  }

  return null;
}




