import { authenticatedWebSocketUrl } from "./config";
import { assertAllowedAuthenticatedAccountRequest } from "./request-guard";
import { parseAuthorizePayload, parseBalancePayload } from "./parse-account";
import type { AccountKind, LinkedAccount } from "./types";

type JsonRecord = Record<string, unknown>;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const PING_MS = 30_000;
const REQUEST_TIMEOUT_MS = 12_000;

export type AuthenticatedAccountHandlers = {
  onStatusChange?: (
    status: "connecting" | "authenticating" | "authenticated" | "disconnected" | "error",
    detail?: string,
  ) => void;
  onAccount?: (account: {
    loginid: string;
    currency: string;
    balance: number | null;
    kind: AccountKind;
    accounts: LinkedAccount[];
  }) => void;
  onBalance?: (balance: number, currency?: string, loginid?: string) => void;
};

export type AccountSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: (() => void) | null;
};

export type AccountSocketFactory = (url: string) => AccountSocket;

export type AuthenticatedClientOptions = {
  createSocket?: AccountSocketFactory;
  reconnectDelayMs?: (attempt: number) => number;
};

type PrivateSession = {
  appId: string;
  token: string;
  expectedLoginid: string;
};

export class AuthenticatedDerivClient {
  private socket: AccountSocket | null = null;
  private reqId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedIntentionally = false;
  private handlers: AuthenticatedAccountHandlers;
  private readonly createSocket: AccountSocketFactory;
  private readonly reconnectDelayMs: (attempt: number) => number;
  private pending = new Map<
    number,
    {
      resolve: (payload: JsonRecord) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  private generation = 0;
  private session: PrivateSession | null = null;
  private opening: Promise<void> | null = null;
  private authenticatedLoginid: string | null = null;
  private balanceSubscribed = false;
  private reconnectAttempt = 0;

  constructor(
    handlers: AuthenticatedAccountHandlers = {},
    options: AuthenticatedClientOptions = {},
  ) {
    this.handlers = handlers;
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.reconnectDelayMs =
      options.reconnectDelayMs ??
      ((attempt) => Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS));
  }

  setHandlers(handlers: AuthenticatedAccountHandlers): void {
    this.handlers = handlers;
  }

  async connectAndAuthorize(params: {
    appId: string;
    token: string;
    expectedLoginid: string;
  }): Promise<void> {
    const sameSession =
      this.session?.expectedLoginid === params.expectedLoginid &&
      this.session?.appId === params.appId;
    if (sameSession && this.opening) {
      return this.opening;
    }
    if (
      sameSession &&
      this.authenticatedLoginid === params.expectedLoginid &&
      this.socket?.readyState === SOCKET_OPEN
    ) {
      return;
    }

    this.generation += 1;
    const generation = this.generation;
    this.clearReconnect();
    this.stopPing();
    this.detachSocket();
    this.session = {
      appId: params.appId,
      token: params.token,
      expectedLoginid: params.expectedLoginid,
    };
    this.authenticatedLoginid = null;
    this.balanceSubscribed = false;
    this.reconnectAttempt = 0;
    this.closedIntentionally = false;
    this.opening = this.openAndAuthorize(generation).finally(() => {
      if (this.generation === generation) {
        this.opening = null;
      }
    });
    return this.opening;
  }

  async logout(): Promise<void> {
    try {
      if (this.socket?.readyState === SOCKET_OPEN) {
        await this.request({ logout: 1 });
      }
    } catch {
      // Still disconnect locally.
    } finally {
      this.disconnect();
    }
  }

  disconnect(): void {
    this.generation += 1;
    this.session = null;
    this.authenticatedLoginid = null;
    this.balanceSubscribed = false;
    this.closedIntentionally = true;
    this.clearReconnect();
    this.stopPing();
    this.rejectPending("Authenticated session disconnected");
    this.detachSocket();
    this.handlers.onStatusChange?.("disconnected");
  }

  private async openAndAuthorize(generation: number): Promise<void> {
    const session = this.session;
    if (!session || generation !== this.generation) {
      return;
    }

    this.handlers.onStatusChange?.("connecting");
    this.detachSocket();

    if (typeof this.createSocket !== "function") {
      this.failClosed(generation, "WebSocket is not available in this environment.");
      return;
    }

    let opened: AccountSocket;
    try {
      opened = this.createSocket(authenticatedWebSocketUrl(session.appId));
    } catch {
      this.failClosed(generation, "Authenticated Deriv WebSocket failed to open.");
      return;
    }

    if (generation !== this.generation) {
      opened.onclose = null;
      opened.close();
      return;
    }

    this.socket = opened;
    const socketGeneration = generation;
    opened.onmessage = (event) => {
      if (socketGeneration !== this.generation) {
        return;
      }
      void this.handleMessage(event);
    };
    opened.onerror = () => {
      if (socketGeneration !== this.generation || this.closedIntentionally) {
        return;
      }
    };
    opened.onclose = () => {
      if (socketGeneration !== this.generation) {
        return;
      }
      this.handleClose();
    };

    try {
      await new Promise<void>((resolve, reject) => {
        if (opened.readyState === SOCKET_OPEN) {
          resolve();
          return;
        }
        opened.onopen = () => resolve();
        const previousError = opened.onerror;
        opened.onerror = (event) => {
          previousError?.(event);
          reject(new Error("Authenticated Deriv WebSocket failed to open."));
        };
      });

      if (generation !== this.generation) {
        return;
      }

      this.startPing();
      this.handlers.onStatusChange?.("authenticating");
      const payload = await this.request({ authorize: session.token });
      if (generation !== this.generation) {
        return;
      }

      const account = parseAuthorizePayload(payload);
      if (!account || account.loginid !== session.expectedLoginid) {
        this.failClosed(
          generation,
          "Authorized account does not match the selected account.",
        );
        return;
      }

      this.authenticatedLoginid = account.loginid;
      this.reconnectAttempt = 0;
      this.handlers.onAccount?.({
        loginid: account.loginid,
        currency: account.currency,
        balance: account.balance,
        kind: account.kind,
        accounts: account.accounts,
      });
      this.handlers.onStatusChange?.("authenticated");
      await this.subscribeBalance(generation);
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.failClosed(
        generation,
        error instanceof Error
          ? error.message
          : "Could not authorize the Deriv account.",
      );
    }
  }

  private async subscribeBalance(generation: number): Promise<void> {
    if (this.balanceSubscribed || generation !== this.generation) {
      return;
    }
    this.balanceSubscribed = true;
    try {
      await this.request({
        balance: 1,
        subscribe: 1,
      });
      if (generation !== this.generation) {
        return;
      }
    } catch {
      if (generation === this.generation) {
        this.balanceSubscribed = false;
      }
    }
  }

  private publishBalance(payload: JsonRecord): void {
    const balance = parseBalancePayload(payload);
    if (!balance) {
      return;
    }
    const expected = this.session?.expectedLoginid;
    if (!expected || this.authenticatedLoginid !== expected) {
      return;
    }
    if (balance.loginid && balance.loginid !== expected) {
      return;
    }
    this.handlers.onBalance?.(balance.balance, balance.currency, balance.loginid ?? expected);
  }

  private failClosed(generation: number, message: string): void {
    if (generation !== this.generation) {
      return;
    }
    this.session = null;
    this.authenticatedLoginid = null;
    this.balanceSubscribed = false;
    this.closedIntentionally = true;
    this.clearReconnect();
    this.stopPing();
    this.rejectPending(message);
    this.detachSocket();
    this.closedIntentionally = false;
    this.handlers.onStatusChange?.("error", message);
  }

  private handleClose(): void {
    this.stopPing();
    this.balanceSubscribed = false;
    this.socket = null;
    this.rejectPending("Authenticated WebSocket closed");
    if (this.closedIntentionally || !this.session || this.reconnectTimer) {
      return;
    }
    if (!this.authenticatedLoginid) {
      this.handlers.onStatusChange?.(
        "error",
        "Authenticated account connection closed.",
      );
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.session || this.closedIntentionally) {
      return;
    }
    this.clearReconnect();
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const delay = this.reconnectDelayMs(attempt);
    this.handlers.onStatusChange?.("connecting", "Reconnecting to Deriv account…");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.session || this.closedIntentionally) {
        return;
      }
      const generation = this.generation;
      this.opening = this.openAndAuthorize(generation).finally(() => {
        if (this.generation === generation) {
          this.opening = null;
        }
      });
    }, delay);
  }

  private request(body: JsonRecord): Promise<JsonRecord> {
    assertAllowedAuthenticatedAccountRequest(body);
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      return Promise.reject(new Error("Authenticated WebSocket is not connected"));
    }

    const reqId = this.nextReqId();
    const payload = { ...body, req_id: reqId };
    assertAllowedAuthenticatedAccountRequest(payload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("Authenticated account request timed out"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timer });
      this.socket?.send(JSON.stringify(payload));
    });
  }

  private async handleMessage(event: { data: unknown }): Promise<void> {
    if (typeof event.data !== "string") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") {
      return;
    }

    const record = payload as JsonRecord;
    const reqId =
      typeof record.req_id === "number" ? record.req_id : Number(record.req_id);

    if (isRecord(record.error)) {
      const message =
        (typeof record.error.message === "string" && record.error.message) ||
        "Deriv account request failed.";
      if (Number.isFinite(reqId) && this.pending.has(reqId)) {
        this.settle(reqId, undefined, new Error(message));
      } else {
        this.handlers.onStatusChange?.("error", message);
      }
      return;
    }

    if (Number.isFinite(reqId) && this.pending.has(reqId)) {
      this.settle(reqId, record);
    }

    if (record.msg_type === "balance") {
      this.publishBalance(record);
    }
  }

  private settle(reqId: number, payload?: JsonRecord, error?: Error): void {
    const pending = this.pending.get(reqId);
    if (!pending) {
      return;
    }
    this.pending.delete(reqId);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (error) {
      pending.reject(error);
      return;
    }
    pending.resolve(payload ?? {});
  }

  private rejectPending(reason: string): void {
    for (const [reqId, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error(reason));
      this.pending.delete(reqId);
    }
  }

  private detachSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING) {
      socket.close();
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
        return;
      }
      try {
        assertAllowedAuthenticatedAccountRequest({ ping: 1 });
        this.socket.send(JSON.stringify({ ping: 1 }));
      } catch {
        // Guard would only fail if ping were disallowed.
      }
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private nextReqId(): number {
    this.reqId += 1;
    return this.reqId;
  }
}

function defaultSocketFactory(url: string): AccountSocket {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is not available in this environment.");
  }
  const socket = new WebSocket(url);
  const wrapped: AccountSocket = {
    get readyState() {
      return socket.readyState;
    },
    send(data: string) {
      socket.send(data);
    },
    close() {
      socket.close();
    },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  };
  socket.onopen = () => {
    wrapped.onopen?.();
  };
  socket.onmessage = (event) => {
    wrapped.onmessage?.({ data: event.data });
  };
  socket.onerror = () => {
    wrapped.onerror?.();
  };
  socket.onclose = () => {
    wrapped.onclose?.();
  };
  return wrapped;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}
