import type { AccountKind } from "./types";

export type BrowserAccount = {
  loginid: string;
  currency: string;
  kind: AccountKind;
  balance: number | null;
};

export type PrivateConnectionState = {
  status: "connecting" | "authenticating" | "authenticated" | "error" | "disconnected";
  detail: string | null;
  loginid: string | null;
  currency: string | null;
  balance: number | null;
  kind: AccountKind | null;
};

export type AccountSelection =
  | { type: "selected"; loginid: string }
  | { type: "required" }
  | { type: "rejected"; reason: string };

export type BrowserAccountPayload = {
  authenticated: boolean;
  accounts: BrowserAccount[];
  selectionRequired: boolean;
  connection: PrivateConnectionState | null;
  detail: string | null;
};

export function resolveAccountSelection(
  accounts: ReadonlyArray<{ loginid: string }>,
  requestedLoginid: string | null,
): AccountSelection {
  if (accounts.length === 0) {
    return {
      type: "rejected",
      reason: "No Deriv accounts are available for this session.",
    };
  }

  const requested = requestedLoginid?.trim() ?? "";
  if (requested) {
    const match = accounts.find((account) => account.loginid === requested);
    if (!match) {
      return {
        type: "rejected",
        reason: "Selected account is not part of this Deriv session.",
      };
    }
    return { type: "selected", loginid: match.loginid };
  }

  if (accounts.length === 1) {
    return { type: "selected", loginid: accounts[0].loginid };
  }

  return { type: "required" };
}

export function toBrowserAccountPayload(params: {
  authenticated: boolean;
  accounts: ReadonlyArray<BrowserAccount>;
  selectionRequired: boolean;
  connection: PrivateConnectionState | null;
  detail?: string | null;
}): BrowserAccountPayload {
  return {
    authenticated: params.authenticated,
    accounts: params.accounts.map((account) => ({
      loginid: account.loginid,
      currency: account.currency,
      kind: account.kind,
      balance: account.balance,
    })),
    selectionRequired: params.selectionRequired,
    connection: params.connection
      ? {
          status: params.connection.status,
          detail: params.connection.detail,
          loginid: params.connection.loginid,
          currency: params.connection.currency,
          balance: params.connection.balance,
          kind: params.connection.kind,
        }
      : null,
    detail: params.detail ?? null,
  };
}

export function emptyPrivateConnection(): PrivateConnectionState {
  return {
    status: "disconnected",
    detail: null,
    loginid: null,
    currency: null,
    balance: null,
    kind: null,
  };
}
