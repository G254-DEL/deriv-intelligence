import { createHash } from "node:crypto";
import {
  emptyPrivateConnection,
  resolveAccountSelection,
  type PrivateConnectionState,
} from "./account-selection";
import {
  AuthenticatedDerivClient,
  type AccountSocketFactory,
} from "./authenticated-client";
import type { RestAccount } from "./rest-accounts";

type SessionEntry = {
  loginid: string;
  client: AuthenticatedDerivClient;
  state: PrivateConnectionState;
};

const sessions = new Map<string, SessionEntry>();
let testSocketFactory: AccountSocketFactory | null = null;

export function setPrivateSocketFactoryForTests(
  factory: AccountSocketFactory | null,
): void {
  testSocketFactory = factory;
}

export function resetPrivateSessionsForTests(): void {
  for (const entry of sessions.values()) {
    entry.client.disconnect();
  }
  sessions.clear();
  testSocketFactory = null;
}

export async function ensurePrivateSession(params: {
  accessToken: string;
  appId: string;
  accounts: RestAccount[];
  loginid: string;
  force?: boolean;
}): Promise<PrivateConnectionState> {
  const decision = resolveAccountSelection(params.accounts, params.loginid);
  if (decision.type !== "selected") {
    return {
      ...emptyPrivateConnection(),
      status: "error",
      detail:
        decision.type === "rejected"
          ? decision.reason
          : "Choose a Deriv account before connecting.",
    };
  }

  const account = params.accounts.find((item) => item.loginid === decision.loginid);
  if (!account) {
    return {
      ...emptyPrivateConnection(),
      status: "error",
      detail: "Selected account is not part of this Deriv session.",
    };
  }

  const key = sessionKey(params.accessToken);
  let entry = sessions.get(key);
  if (
    entry &&
    entry.loginid === account.loginid &&
    !params.force &&
    entry.state.status !== "disconnected"
  ) {
    return entry.state;
  }

  if (!entry) {
    entry = createEntry(key);
    sessions.set(key, entry);
  }

  entry.loginid = account.loginid;
  entry.state = {
    status: "connecting",
    detail: null,
    loginid: account.loginid,
    currency: account.currency,
    balance: null,
    kind: account.kind,
  };

  await entry.client.connectAndAuthorize({
    appId: params.appId,
    token: params.accessToken,
    expectedLoginid: account.loginid,
  });

  return entry.state;
}

export function releasePrivateSession(accessToken: string): void {
  const key = sessionKey(accessToken);
  const entry = sessions.get(key);
  if (!entry) {
    return;
  }
  entry.client.disconnect();
  sessions.delete(key);
}

function createEntry(key: string): SessionEntry {
  const entry: SessionEntry = {
    loginid: "",
    client: null as unknown as AuthenticatedDerivClient,
    state: emptyPrivateConnection(),
  };
  const client = new AuthenticatedDerivClient(
    {
      onStatusChange: (status, detail) => {
        if (status === "disconnected") {
          entry.state = {
            ...entry.state,
            status: "disconnected",
            detail: detail ?? null,
            balance: null,
          };
          return;
        }
        entry.state = {
          ...entry.state,
          status: status === "error" ? "error" : status,
          detail: detail ?? null,
        };
      },
      onAccount: (account) => {
        if (account.loginid !== entry.loginid) {
          return;
        }
        entry.state = {
          status: "authenticated",
          detail: null,
          loginid: account.loginid,
          currency: account.currency,
          balance: account.balance,
          kind: account.kind,
        };
      },
      onBalance: (balance, currency, loginid) => {
        if (loginid && loginid !== entry.loginid) {
          return;
        }
        if (entry.state.loginid !== entry.loginid) {
          return;
        }
        entry.state = {
          ...entry.state,
          balance,
          currency: currency ?? entry.state.currency,
          loginid: entry.loginid,
        };
      },
    },
    testSocketFactory ? { createSocket: testSocketFactory } : {},
  );
  entry.client = client;
  return entry;
}

function sessionKey(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}
