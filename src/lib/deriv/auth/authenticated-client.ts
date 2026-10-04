import { authenticatedWebSocketUrl } from "./config";
import { assertAllowedAuthenticatedAccountRequest } from "./request-guard";
import { parseAuthorizePayload, parseBalancePayload } from "./parse-account";
import type { AccountKind, LinkedAccount } from "./types";

type JsonRecord = Record<string, unknown>;

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

const PING_MS = 30_000;
const REQUEST_TIMEOUT_MS = 12_000;

export class AuthenticatedDerivClient {
  private socket: WebSocket | null = null;
  private reqId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedIntentionally = false;
  private handlers: AuthenticatedAccountHandlers;
  private pending = new Map<
    number,
    {
      resolve: (payload: JsonRecord) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();

  constructor(handlers: AuthenticatedAccountHandlers = {}) {
    this.handlers = handlers;
  }

  setHandlers(handlers: AuthenticatedAccountHandlers): void {
    this.handlers = handlers;
  }

  async connectAndAuthorize(params: {
    appId: string;
    token: string;
  }): Promise<void> {
    this.disconnect();
    this.closedIntentionally = false;
    this.handlers.onStatusChange?.("connecting");

    if (typeof WebSocket === "undefined") {
      this.handlers.onStatusChange?.(
        "error",
        "WebSocket is not available in this environment.",
      );
      throw new Error("WebSocket is not available in this environment.");
    }

    const url = authenticatedWebSocketUrl(params.appId);

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => {
        this.handlers.onStatusChange?.("authenticating");
        resolve();
      };
      socket.onerror = () => {
        reject(new Error("Authenticated Deriv WebSocket failed to open."));
      };
      socket.onclose = () => {
        this.handleClose();
      };
      socket.onmessage = (event: MessageEvent) => {
        void this.handleMessage(event);
      };
    });

    this.startPing();

    const payload = await this.request({ authorize: params.token });
    const account = parseAuthorizePayload(payload);
    if (!account) {
      throw new Error("Authorize response did not include an account.");
    }

    this.handlers.onAccount?.(account);
    this.handlers.onStatusChange?.("authenticated");

    try {
      const balancePayload = await this.request({
        balance: 1,
        subscribe: 1,
      });
      const balance = parseBalancePayload(balancePayload);
      if (balance) {
        this.handlers.onBalance?.(
          balance.balance,
          balance.currency,
          balance.loginid,
        );
      }
    } catch {
      // Balance is optional after a successful authorize.
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.socket?.readyState === WebSocket.OPEN) {
        await this.request({ logout: 1 });
      }
    } catch {
      // Still disconnect locally.
    } finally {
      this.disconnect();
    }
  }

  disconnect(): void {
    this.closedIntentionally = true;
    this.stopPing();
    this.rejectPending("Authenticated session disconnected");
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
    }
    this.socket = null;
    this.handlers.onStatusChange?.("disconnected");
  }

  private request(body: JsonRecord): Promise<JsonRecord> {
    assertAllowedAuthenticatedAccountRequest(body);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
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

  private async handleMessage(event: MessageEvent): Promise<void> {
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

    const balance = parseBalancePayload(record);
    if (balance && record.msg_type === "balance") {
      this.handlers.onBalance?.(
        balance.balance,
        balance.currency,
        balance.loginid,
      );
    }
  }

  private handleClose(): void {
    this.stopPing();
    this.rejectPending("Authenticated WebSocket closed");
    this.socket = null;
    if (!this.closedIntentionally) {
      this.handlers.onStatusChange?.(
        "error",
        "Authenticated account connection closed.",
      );
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

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}
