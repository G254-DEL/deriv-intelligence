import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DERIV_PUBLIC_WS_URL } from "../constants";
import { assertAllowedPublicMarketDataRequest } from "../public-request-guard";
import {
  resolveAccountSelection,
  toBrowserAccountPayload,
} from "./account-selection";
import {
  AuthenticatedDerivClient,
  type AccountSocket,
} from "./authenticated-client";
import { authenticatedWebSocketUrl } from "./config";
import { assertAllowedAuthenticatedAccountRequest } from "./request-guard";
import { LIVE_ORDERS_ENABLED } from "../../trading/live-orders";

const DEMO = "VRTC1001";
const REAL = "CR9001";

test("one account is selected automatically", () => {
  const decision = resolveAccountSelection(
    [{ loginid: DEMO }],
    null,
  );
  assert.deepEqual(decision, { type: "selected", loginid: DEMO });
});

test("multiple accounts require an explicit choice", () => {
  const decision = resolveAccountSelection(
    [{ loginid: DEMO }, { loginid: REAL }],
    null,
  );
  assert.equal(decision.type, "required");
});

test("demo and real accounts are selected by loginid", () => {
  const accounts = [
    { loginid: DEMO, kind: "demo" as const },
    { loginid: REAL, kind: "real" as const },
  ];
  assert.deepEqual(resolveAccountSelection(accounts, DEMO), {
    type: "selected",
    loginid: DEMO,
  });
  assert.deepEqual(resolveAccountSelection(accounts, REAL), {
    type: "selected",
    loginid: REAL,
  });
});

test("an account outside the OAuth list is rejected", () => {
  const decision = resolveAccountSelection(
    [{ loginid: DEMO }, { loginid: REAL }],
    "CR0000",
  );
  assert.equal(decision.type, "rejected");
});

test("browser account payload does not carry an OAuth token", () => {
  const secret = "oauth-access-token-fixture";
  const payload = toBrowserAccountPayload({
    authenticated: true,
    accounts: [
      { loginid: REAL, currency: "USD", kind: "real", balance: 25 },
    ],
    selectionRequired: false,
    connection: {
      status: "authenticated",
      detail: null,
      loginid: REAL,
      currency: "USD",
      balance: 25,
      kind: "real",
    },
  });
  const encoded = JSON.stringify(payload);
  if (encoded.includes(secret) || encoded.includes("access_token")) {
    throw new Error("OAuth token appeared in a browser-visible payload");
  }
  assert.equal(payload.connection?.loginid, REAL);
  assert.equal("token" in payload, false);
});

test("authorize succeeds for the selected account", async () => {
  const seen: string[] = [];
  const sockets = createSockets(() => ({
    loginid: REAL,
    isVirtual: 0,
    balance: 42,
  }));
  const client = new AuthenticatedDerivClient(
    {
      onAccount: (account) => {
        seen.push(account.loginid);
      },
    },
    { createSocket: sockets.factory, reconnectDelayMs: () => 20 },
  );
  try {
    await client.connectAndAuthorize({
      appId: "app",
      token: "server-side-fixture",
      expectedLoginid: REAL,
    });
    assert.deepEqual(seen, [REAL]);
    assert.deepEqual(sockets.sockets[0]?.types(), ["authorize", "balance"]);
  } finally {
    client.disconnect();
  }
});

test("authorize loginid mismatch fails closed before balance", async () => {
  const statuses: string[] = [];
  const sockets = createSockets(() => ({
    loginid: DEMO,
    isVirtual: 1,
    balance: 5,
  }));
  const client = new AuthenticatedDerivClient(
    {
      onStatusChange: (status, detail) => {
        statuses.push(detail ?? status);
      },
    },
    { createSocket: sockets.factory, reconnectDelayMs: () => 20 },
  );
  try {
    await client.connectAndAuthorize({
      appId: "app",
      token: "server-side-fixture",
      expectedLoginid: REAL,
    });
    await delay(40);
    assert.equal(sockets.sockets.length, 1);
    assert.deepEqual(sockets.sockets[0]?.types(), ["authorize"]);
    assert.equal(
      statuses.some((status) => status.includes("does not match")),
      true,
    );
  } finally {
    client.disconnect();
  }
});

test("reconnect re-authorizes the same selected account", async () => {
  const authorized: string[] = [];
  const sockets = createSockets(() => ({
    loginid: DEMO,
    isVirtual: 1,
    balance: 8,
  }));
  const client = new AuthenticatedDerivClient(
    {
      onAccount: (account) => {
        authorized.push(account.loginid);
      },
    },
    { createSocket: sockets.factory, reconnectDelayMs: () => 20 },
  );
  try {
    await client.connectAndAuthorize({
      appId: "app",
      token: "server-side-fixture",
      expectedLoginid: DEMO,
    });
    sockets.sockets[0]?.close();
    await delay(50);
    assert.equal(sockets.sockets.length, 2);
    assert.deepEqual(authorized, [DEMO, DEMO]);
    assert.equal(sockets.sockets[1]?.types().includes("authorize"), true);
    assert.equal(sockets.sockets[1]?.types().filter((type) => type === "balance").length, 1);
  } finally {
    client.disconnect();
  }
});

test("account switch drops stale balance from the previous account", async () => {
  const balances: Array<{ loginid?: string; balance: number }> = [];
  let mode: "real" | "demo" = "real";
  const sockets = createSockets(() =>
    mode === "real"
      ? { loginid: REAL, isVirtual: 0, balance: 10 }
      : { loginid: DEMO, isVirtual: 1, balance: 3 },
  );
  const client = new AuthenticatedDerivClient(
    {
      onBalance: (balance, _currency, loginid) => {
        balances.push({ loginid, balance });
      },
    },
    { createSocket: sockets.factory, reconnectDelayMs: () => 20 },
  );
  try {
    await client.connectAndAuthorize({
      appId: "app",
      token: "server-side-fixture",
      expectedLoginid: REAL,
    });
    mode = "demo";
    await client.connectAndAuthorize({
      appId: "app",
      token: "server-side-fixture",
      expectedLoginid: DEMO,
    });
    sockets.sockets.at(-1)?.receive({
      msg_type: "balance",
      balance: { balance: 99, currency: "USD", loginid: REAL },
    });
    assert.equal(sockets.sockets.length, 2);
    assert.equal(
      balances.some((item) => item.loginid === REAL && item.balance === 99),
      false,
    );
    assert.equal(
      balances.some((item) => item.loginid === DEMO),
      true,
    );
  } finally {
    client.disconnect();
  }
});

test("a second connect for the same account does not open another socket", async () => {
  const sockets = createSockets(() => ({
    loginid: REAL,
    isVirtual: 0,
    balance: 1,
  }));
  const client = new AuthenticatedDerivClient(
    {},
    { createSocket: sockets.factory, reconnectDelayMs: () => 20 },
  );
  try {
    await Promise.all([
      client.connectAndAuthorize({
        appId: "app",
        token: "server-side-fixture",
        expectedLoginid: REAL,
      }),
      client.connectAndAuthorize({
        appId: "app",
        token: "server-side-fixture",
        expectedLoginid: REAL,
      }),
    ]);
    assert.equal(sockets.sockets.length, 1);
    assert.equal(sockets.sockets[0]?.types().filter((type) => type === "balance").length, 1);
  } finally {
    client.disconnect();
  }
});

test("public market socket stays separate and both guards reject buy and sell", () => {
  assert.equal(LIVE_ORDERS_ENABLED, false);
  assert.equal(authenticatedWebSocketUrl("app").includes("/ws/public"), false);
  assert.equal(DERIV_PUBLIC_WS_URL.includes("authorize"), false);
  for (const key of ["buy", "sell"] as const) {
    assert.throws(
      () => assertAllowedAuthenticatedAccountRequest({ [key]: 1 }),
      new RegExp(key, "i"),
    );
    assert.throws(
      () => assertAllowedPublicMarketDataRequest({ [key]: 1 }),
      new RegExp(key, "i"),
    );
  }
  const privateSource = readFileSync(
    new URL("./private-session.ts", import.meta.url),
    "utf8",
  );
  const browserSession = readFileSync(
    new URL("./account-session.ts", import.meta.url),
    "utf8",
  );
  const legacyStore = readFileSync(
    new URL("./session-store.ts", import.meta.url),
    "utf8",
  );
  assert.equal(privateSource.includes("public-market-data"), false);
  assert.equal(browserSession.includes("connectAndAuthorize"), false);
  assert.equal(browserSession.includes("savePersistedSession"), false);
  assert.equal(legacyStore.includes("sessionStorage.setItem"), false);
});

function createSockets(
  accountFor: () => { loginid: string; isVirtual: number; balance: number },
) {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: () => {
      const socket = new FakeSocket(accountFor);
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    },
  };
}

class FakeSocket implements AccountSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    private readonly accountFor: () => {
      loginid: string;
      isVirtual: number;
      balance: number;
    },
  ) {}

  send(data: string): void {
    this.sent.push(data);
    const body = JSON.parse(data) as { req_id?: number; authorize?: unknown; balance?: unknown };
    if ("authorize" in body) {
      const account = this.accountFor();
      queueMicrotask(() => {
        this.receive({
          req_id: body.req_id,
          authorize: {
            loginid: account.loginid,
            currency: "USD",
            balance: account.balance,
            is_virtual: account.isVirtual,
          },
        });
      });
    }
    if ("balance" in body) {
      const account = this.accountFor();
      queueMicrotask(() => {
        this.receive({
          req_id: body.req_id,
          msg_type: "balance",
          balance: {
            balance: account.balance,
            currency: "USD",
            loginid: account.loginid,
          },
        });
      });
    }
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  types(): string[] {
    return this.sent.map((raw) => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      if ("authorize" in body) {
        return "authorize";
      }
      if ("balance" in body) {
        return "balance";
      }
      if ("ping" in body) {
        return "ping";
      }
      return "other";
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
