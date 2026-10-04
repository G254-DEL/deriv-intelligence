import { DERIV_PUBLIC_WS_URL, MAX_LIVE_TICK_STREAMS, TICK_STALE_AFTER_MS } from "./constants";
import { classifyMarketCategory, isPublicDigitMarket } from "./classify-market";
import { TickHistoryStore } from "./tick-history";
import {
  decimalPlacesFromPipSize,
  extractLastDisplayedDigit,
} from "../digits/extract-last-digit";
import type {
  ContractsForRequest,
  DerivActiveSymbol,
  DerivConnectionState,
  DerivTick,
  MarketTickSnapshot,
  MarketTickStatus,
  DerivProposal,
  ProposalRequest,
  Tick,
  TickHandler,
  TicksHistoryRequest,
  Unsubscribe,
} from "./types";
import { assertAllowedPublicMarketDataRequest } from "./public-request-guard";

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
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;
const PROPOSAL_TIMEOUT_MS = 10000;

type PendingProposal = {
  resolve: (proposal: DerivProposal) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

function clearPendingProposal(
  pendingProposals: Map<number, PendingProposal>,
  reqId: number,
): void {
  const pending = pendingProposals.get(reqId);
  if (!pending) {
    return;
  }
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
  }
  pendingProposals.delete(reqId);
}

function rejectPendingProposals(
  pendingProposals: Map<number, PendingProposal>,
  reason: string,
): void {
  for (const [reqId, pending] of pendingProposals) {
    if (pending.timer !== null) {
      clearTimeout(pending.timer);
    }
    pendingProposals.delete(reqId);
    pending.reject(new Error(reason));
  }
}

type PendingCall = {
  resolve: (payload: JsonRecord) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

function clearPendingCall(
  pendingCalls: Map<number, PendingCall>,
  reqId: number,
): void {
  const pending = pendingCalls.get(reqId);
  if (!pending) {
    return;
  }
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
  }
  pendingCalls.delete(reqId);
}

function rejectPendingCalls(
  pendingCalls: Map<number, PendingCall>,
  reason: string,
): void {
  for (const [reqId, pending] of pendingCalls) {
    if (pending.timer !== null) {
      clearTimeout(pending.timer);
    }
    pendingCalls.delete(reqId);
    pending.reject(new Error(reason));
  }
}

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
  private readonly pendingProposals = new Map<number, PendingProposal>();
  private readonly pendingCalls = new Map<number, PendingCall>();
  private readonly symbolTickHandlers = new Map<string, Set<TickHandler>>();
  private readonly connectionWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private handlers: PublicMarketDataHandlers;
  private generation = 0;
  private closedIntentionally = false;
  private cachedSymbols: DerivActiveSymbol[] = [];
  private readonly tickHistory = new TickHistoryStore();
  private readonly subscriptions = new Map<string, TickSubscription>();
  private readonly latestTicks = new Map<string, MarketTickSnapshot>();
  private desiredSymbols: string[] = [];
  private staleTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;

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

  getCachedSymbols(): DerivActiveSymbol[] {
    return this.cachedSymbols;
  }

  getLatestTicks(): ReadonlyMap<string, MarketTickSnapshot> {
    return this.latestTicks;
  }

  waitForConnected(timeoutMs = 15000): Promise<void> {
    if (this.state === "connected" && this.canSend()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.connectionWaiters.indexOf(waiter);
        if (index >= 0) {
          this.connectionWaiters.splice(index, 1);
        }
        reject(new Error("Timed out connecting to Deriv market data"));
      }, timeoutMs);

      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      this.connectionWaiters.push(waiter);
    });
  }

  async fetchActiveSymbols(
    productType: "brief" | "full" = "brief",
  ): Promise<DerivActiveSymbol[]> {
    const payload = await this.requestJson({
      active_symbols: productType,
    });
    const symbols = parseActiveSymbols(findActiveSymbols(payload));
    this.cachedSymbols = symbols;
    this.handlers.onActiveSymbols?.(symbols);
    return symbols;
  }

  async requestTicksHistory(request: TicksHistoryRequest): Promise<Tick[]> {
    const payload = await this.requestJson({
      ticks_history: request.ticks_history,
      end: request.end,
      style: request.style ?? "ticks",
      ...(request.start === undefined ? {} : { start: request.start }),
      ...(request.count === undefined ? {} : { count: request.count }),
    });
    return parseTicksHistory(payload, request.ticks_history);
  }

  async requestContractsFor(request: ContractsForRequest): Promise<unknown> {
    const payload = await this.requestJson({
      contracts_for: request.contracts_for,
      ...(request.product_type === undefined
        ? {}
        : { product_type: request.product_type }),
    });
    return payload.contracts_for ?? payload;
  }

  subscribeSymbolTicks(symbol: string, onTick: TickHandler): Unsubscribe {
    let handlers = this.symbolTickHandlers.get(symbol);
    if (!handlers) {
      handlers = new Set();
      this.symbolTickHandlers.set(symbol, handlers);
    }
    handlers.add(onTick);
    this.subscribeTicks(symbol);

    return () => {
      const current = this.symbolTickHandlers.get(symbol);
      current?.delete(onTick);
      if (current && current.size === 0) {
        this.symbolTickHandlers.delete(symbol);
      }
    };
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
    this.clearReconnectTimer();
    this.generation += 1;
    const generation = this.generation;

    this.setState(
      "connecting",
      this.reconnectAttempt > 0
        ? `Reconnecting to Deriv market data (attempt ${this.reconnectAttempt})…`
        : undefined,
    );
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
      this.scheduleReconnect();
    }
  }

  requestActiveSymbols(): void {
    derivLog("[Deriv] Requesting active symbols...");
    this.send({
      ...ACTIVE_SYMBOLS_REQUEST,
      req_id: this.nextReqId(),
    });
  }

  requestProposal(request: Omit<ProposalRequest, "proposal" | "req_id">): Promise<DerivProposal> {
    const payload = {
      ...request,
      proposal: 1 as const,
      req_id: this.reqId + 1,
    };

    try {
      assertAllowedPublicMarketDataRequest(payload);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("Rejected live-order request"),
      );
    }

    if (!this.canSend()) {
      return Promise.reject(new Error("Deriv WebSocket is not connected"));
    }

    const reqId = this.nextReqId();

    return new Promise<DerivProposal>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingProposals.get(reqId);
        if (!pending) {
          return;
        }
        this.pendingProposals.delete(reqId);
        pending.reject(new Error("Proposal request timed out"));
      }, PROPOSAL_TIMEOUT_MS);

      this.pendingProposals.set(reqId, { resolve, reject, timer });

      this.send({
        ...request,
        proposal: 1,
        req_id: reqId,
      });
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
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
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
    rejectPendingProposals(this.pendingProposals, "WebSocket disconnected");
    rejectPendingCalls(this.pendingCalls, "WebSocket disconnected");
    this.rejectConnectionWaiters(new Error("WebSocket disconnected"));

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
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
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
      const failedReqId = readNumber(payload.req_id);
    if (failedReqId !== undefined) {
      const pendingProposal = this.pendingProposals.get(failedReqId);
      if (pendingProposal) {
        clearPendingProposal(this.pendingProposals, failedReqId);
        pendingProposal.reject(new Error(apiError));
        return;
      }
      const pendingCall = this.pendingCalls.get(failedReqId);
      if (pendingCall) {
        clearPendingCall(this.pendingCalls, failedReqId);
        pendingCall.reject(new Error(apiError));
        return;
      }
    }

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
      this.settlePendingCall(readNumber(payload.req_id), payload);
      return;
    }

    const msgType = typeof payload.msg_type === "string" ? payload.msg_type : "";

    if (msgType === "history" || isRecord(payload.history)) {
      if (this.settlePendingCall(readNumber(payload.req_id), payload)) {
        return;
      }
    }

    if (msgType === "contracts_for" || payload.contracts_for !== undefined) {
      if (this.settlePendingCall(readNumber(payload.req_id), payload)) {
        return;
      }
    }

    if (msgType === "proposal" && isRecord(payload.proposal)) {
      const reqId = readNumber(payload.req_id);
      const pending = reqId == null ? undefined : this.pendingProposals.get(reqId);

      if (pending && reqId !== undefined) {
        clearPendingProposal(this.pendingProposals, reqId);
        pending.resolve(payload.proposal as DerivProposal);
      }

      return;
    }

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
      this.dispatchSymbolTick(tick);
    }
  }

  private handleSocketError(): void {
    derivLog("[Deriv] WebSocket error");
    rejectPendingProposals(this.pendingProposals, "WebSocket connection failure.");
    rejectPendingCalls(this.pendingCalls, "WebSocket connection failure.");
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
    rejectPendingProposals(this.pendingProposals, "WebSocket closed");
    rejectPendingCalls(this.pendingCalls, "WebSocket closed");

    if (this.closedIntentionally) {
      this.rejectConnectionWaiters(new Error("WebSocket disconnected"));
      this.setState("disconnected");
      return;
    }

    const detail = event.reason
      ? `WebSocket closed (${event.code}: ${event.reason})`
      : `WebSocket closed (${event.code})`;

    this.setState("error", detail);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closedIntentionally || this.reconnectTimer !== null) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    derivLog("[Deriv] Reconnecting in", `${delay}ms`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedIntentionally) {
        this.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = null;
  }

  private send(body: JsonRecord): void {
    assertAllowedPublicMarketDataRequest(body);

    if (!this.canSend() || !this.socket) {
      if (!this.closedIntentionally) {
        derivLog("[Deriv] WebSocket error", "Cannot send because the socket is not open.");
      }
      return;
    }

    this.socket.send(JSON.stringify(body));
  }

  private requestJson(body: JsonRecord): Promise<JsonRecord> {
    assertAllowedPublicMarketDataRequest(body);

    if (!this.canSend()) {
      return Promise.reject(new Error("Deriv WebSocket is not connected"));
    }

    const reqId = this.nextReqId();
    const payload = { ...body, req_id: reqId };

    return new Promise<JsonRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingCalls.get(reqId);
        if (!pending) {
          return;
        }
        this.pendingCalls.delete(reqId);
        pending.reject(new Error("Market-data request timed out"));
      }, PROPOSAL_TIMEOUT_MS);

      this.pendingCalls.set(reqId, { resolve, reject, timer });
      this.send(payload);
    });
  }

  private settlePendingCall(
    reqId: number | undefined,
    payload: JsonRecord,
  ): boolean {
    if (reqId === undefined) {
      return false;
    }
    const pending = this.pendingCalls.get(reqId);
    if (!pending) {
      return false;
    }
    clearPendingCall(this.pendingCalls, reqId);
    pending.resolve(payload);
    return true;
  }

  private resolveConnectionWaiters(): void {
    const waiters = this.connectionWaiters.splice(0);
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  private rejectConnectionWaiters(error: Error): void {
    const waiters = this.connectionWaiters.splice(0);
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }

  private dispatchSymbolTick(tick: DerivTick): void {
    const handlers = this.symbolTickHandlers.get(tick.symbol);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const quote =
      typeof tick.quote === "number" ? tick.quote : Number(tick.quote);
    if (!Number.isFinite(quote)) {
      return;
    }

    const mapped: Tick = {
      symbol: tick.symbol,
      quote,
      epoch: tick.epoch,
    };
    for (const handler of handlers) {
      handler(mapped);
    }
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
    if (state === "connected") {
      this.resolveConnectionWaiters();
    }
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
let sharedReleaseTimer: number | null = null;
const sharedHandlers = new Set<PublicMarketDataHandlers>();

function fanOutHandlers(): PublicMarketDataHandlers {
  return {
    onConnectionChange: (state, detail) => {
      for (const handler of sharedHandlers) {
        handler.onConnectionChange?.(state, detail);
      }
    },
    onActiveSymbols: (symbols) => {
      for (const handler of sharedHandlers) {
        handler.onActiveSymbols?.(symbols);
      }
    },
    onTick: (tick) => {
      for (const handler of sharedHandlers) {
        handler.onTick?.(tick);
      }
    },
    onMarketTick: (snapshot) => {
      for (const handler of sharedHandlers) {
        handler.onMarketTick?.(snapshot);
      }
    },
    onTickStatus: (symbol, status, detail) => {
      for (const handler of sharedHandlers) {
        handler.onTickStatus?.(symbol, status, detail);
      }
    },
    onError: (message) => {
      for (const handler of sharedHandlers) {
        handler.onError?.(message);
      }
    },
  };
}

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

  sharedHandlers.add(handlers);

  if (!sharedClient) {
    sharedClient = new PublicMarketDataClient(fanOutHandlers());
    sharedClient.connect();
  } else {
    sharedClient.setHandlers(fanOutHandlers());
    sharedClient.connect();
  }

  const client = sharedClient;

  return {
    client,
    release: () => {
      sharedHandlers.delete(handlers);
      if (sharedHandlers.size > 0) {
        sharedClient?.setHandlers(fanOutHandlers());
        return;
      }

      if (!sharedClient) {
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
        if (sharedHandlers.size === 0 && sharedClient === session) {
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
    if (parsed && isPublicDigitMarket(parsed)) {
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

export function parseTicksHistory(payload: unknown, symbol: string): Tick[] {
  if (!isRecord(payload) || !isRecord(payload.history)) {
    return [];
  }

  const prices = payload.history.prices;
  const times = payload.history.times;
  if (!Array.isArray(prices) || !Array.isArray(times)) {
    return [];
  }

  const ticks: Tick[] = [];
  const length = Math.min(prices.length, times.length);

  for (let index = 0; index < length; index += 1) {
    const quote = Number(prices[index]);
    const epoch = Number(times[index]);
    if (!Number.isFinite(quote) || !Number.isFinite(epoch)) {
      continue;
    }
    ticks.push({ symbol, quote, epoch });
  }

  return ticks;
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







