import { AuthenticatedDerivClient } from "./authenticated-client";
import {
  getDerivAppId,
  getDerivOAuthClientId,
  getDerivOAuthRedirectUri,
} from "./config";
import {
  buildSignInUrl,
  clearPkceSession,
  parseOAuthRedirectSearch,
  readPkceSession,
  stripOAuthParamsFromUrl,
} from "./oauth";
import { accountKindFromLoginid } from "./parse-account";
import type { RestAccount } from "./rest-accounts";
import {
  clearPersistedSession,
  loadPersistedSession,
  savePersistedSession,
} from "./session-store";
import type {
  AccountSnapshot,
  AuthConnectionStatus,
  LinkedAccount,
  OAuthAccountToken,
} from "./types";

const listeners = new Set<() => void>();

const signedOut: AccountSnapshot = {
  status: "signed_out",
  detail: null,
  loginid: null,
  currency: null,
  balance: null,
  kind: null,
  accounts: [],
  configured: Boolean(getDerivAppId() || getDerivOAuthClientId()),
};

let snapshot: AccountSnapshot = { ...signedOut };
const client = new AuthenticatedDerivClient();
let started = false;

client.setHandlers({
  onStatusChange: (status, detail) => {
    if (status === "disconnected" && snapshot.status === "signed_out") {
      return;
    }
    if (status === "disconnected") {
      return;
    }
    const mapped: AuthConnectionStatus =
      status === "authenticated"
        ? "authenticated"
        : status === "error"
          ? "error"
          : status === "authenticating"
            ? "authenticating"
            : "connecting";
    updateSnapshot({
      status: mapped,
      detail: detail ?? snapshot.detail,
    });
  },
  onAccount: (account) => {
    updateSnapshot({
      status: "authenticated",
      detail: null,
      loginid: account.loginid,
      currency: account.currency || snapshot.currency,
      balance: account.balance,
      kind: account.kind,
      accounts: account.accounts,
    });
  },
  onBalance: (balance, currency, loginid) => {
    updateSnapshot({
      balance,
      currency: currency ?? snapshot.currency,
      loginid: loginid ?? snapshot.loginid,
      kind: accountKindFromLoginid(
        loginid ?? snapshot.loginid,
        snapshot.kind === "demo" ? 1 : snapshot.kind === "real" ? 0 : null,
      ),
    });
  },
});

export function getAccountSnapshot(): AccountSnapshot {
  return snapshot;
}

export function subscribeAccountSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startAccountSession(): void {
  if (started || typeof window === "undefined") {
    return;
  }
  started = true;
  snapshot = {
    ...snapshot,
    configured: Boolean(getDerivAppId() || getDerivOAuthClientId()),
    status:
      getDerivAppId() || getDerivOAuthClientId()
        ? snapshot.status
        : "unconfigured",
    detail:
      getDerivAppId() || getDerivOAuthClientId()
        ? snapshot.detail
        : "Set NEXT_PUBLIC_DERIV_APP_ID to enable Deriv account login.",
  };
  emit();
  void consumeRedirectAndRestore();
}

export async function signInToDerivAccount(): Promise<void> {
  if (!getDerivAppId() && !getDerivOAuthClientId()) {
    updateSnapshot({
      status: "unconfigured",
      detail:
        "Set NEXT_PUBLIC_DERIV_APP_ID (and optionally NEXT_PUBLIC_DERIV_OAUTH_CLIENT_ID) to enable Deriv login.",
    });
    return;
  }
  const url = await buildSignInUrl();
  window.location.assign(url);
}

export async function signOutDerivAccount(): Promise<void> {
  clearPersistedSession();
  clearPkceSession();
  await client.logout();
  try {
    await fetch("/api/deriv/oauth/token", { method: "DELETE" });
  } catch {
    // Local sign-out still proceeds.
  }
  snapshot = {
    ...signedOut,
    configured: Boolean(getDerivAppId() || getDerivOAuthClientId()),
    status:
      getDerivAppId() || getDerivOAuthClientId() ? "signed_out" : "unconfigured",
  };
  emit();
}

async function consumeRedirectAndRestore(): Promise<void> {
  const parsed = parseOAuthRedirectSearch(window.location.search);
  if (parsed.type !== "none") {
    const clean = stripOAuthParamsFromUrl(window.location.href);
    window.history.replaceState(null, "", clean);
  }

  if (parsed.type === "error") {
    updateSnapshot({ status: "error", detail: parsed.message });
    return;
  }

  if (parsed.type === "legacy_tokens") {
    await authorizeLegacyAccounts(parsed.accounts);
    return;
  }

  if (parsed.type === "oauth2_code") {
    await exchangeOAuth2Code(parsed.code, parsed.state);
    return;
  }

  const persisted = loadPersistedSession();
  if (persisted) {
    await authorizeLegacyAccounts(persisted.accounts, persisted.selectedLoginid);
    return;
  }

  await restoreOAuth2CookieSession();
}

async function authorizeLegacyAccounts(
  accounts: OAuthAccountToken[],
  selectedLoginid?: string,
): Promise<void> {
  const appId = getDerivAppId();
  if (!appId) {
    updateSnapshot({
      status: "error",
      detail:
        "NEXT_PUBLIC_DERIV_APP_ID is required to open an authenticated Deriv session.",
    });
    return;
  }

  const selected =
    accounts.find((item) => item.loginid === selectedLoginid) ?? accounts[0];
  if (!selected) {
    updateSnapshot({
      status: "error",
      detail: "No Deriv account token was returned.",
    });
    return;
  }

  savePersistedSession({
    accounts,
    selectedLoginid: selected.loginid,
  });

  updateSnapshot({
    status: "connecting",
    detail: "Connecting to Deriv account…",
    loginid: selected.loginid,
    currency: selected.currency || null,
    kind: accountKindFromLoginid(selected.loginid),
    accounts: toLinked(accounts),
  });

  try {
    await client.connectAndAuthorize({ appId, token: selected.token });
  } catch (error) {
    updateSnapshot({
      status: "error",
      detail:
        error instanceof Error
          ? error.message
          : "Could not authorize the Deriv account.",
    });
  }
}

async function exchangeOAuth2Code(code: string, state: string): Promise<void> {
  const pkce = readPkceSession();
  clearPkceSession();
  if (!pkce || pkce.state !== state) {
    updateSnapshot({
      status: "error",
      detail: "OAuth state mismatch. Start sign-in again.",
    });
    return;
  }

  const redirectUri = getDerivOAuthRedirectUri();
  if (!redirectUri) {
    updateSnapshot({
      status: "error",
      detail: "OAuth redirect URI is not configured.",
    });
    return;
  }

  updateSnapshot({
    status: "authenticating",
    detail: "Completing Deriv sign-in…",
  });

  try {
    const response = await fetch("/api/deriv/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: pkce.verifier,
        redirect_uri: redirectUri,
      }),
    });
    const body = (await response.json()) as {
      error?: string;
      accounts?: RestAccount[];
    };
    if (!response.ok) {
      updateSnapshot({
        status: "error",
        detail: body.error ?? "Token exchange failed.",
      });
      return;
    }
    applyRestAccounts(body.accounts ?? []);
  } catch {
    updateSnapshot({
      status: "error",
      detail: "Could not complete Deriv OAuth token exchange.",
    });
  }
}

async function restoreOAuth2CookieSession(): Promise<void> {
  try {
    const response = await fetch("/api/deriv/account");
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as {
      authenticated?: boolean;
      accounts?: RestAccount[];
    };
    if (body.authenticated) {
      applyRestAccounts(body.accounts ?? []);
    }
  } catch {
    // Stay signed out if cookie restore fails.
  }
}

function applyRestAccounts(accounts: RestAccount[]): void {
  const first = accounts[0];
  updateSnapshot({
    status: "authenticated",
    detail: first
      ? null
      : "Signed in with OAuth 2.0. Account details were not returned.",
    loginid: first?.loginid ?? "signed-in",
    currency: first?.currency ?? null,
    balance: first?.balance ?? null,
    kind: first?.kind ?? "unknown",
    accounts: accounts.map(({ loginid, currency, kind }) => ({
      loginid,
      currency,
      kind,
    })),
  });
}

function toLinked(accounts: OAuthAccountToken[]): LinkedAccount[] {
  return accounts.map((account) => ({
    loginid: account.loginid,
    currency: account.currency,
    kind: accountKindFromLoginid(account.loginid),
  }));
}

function updateSnapshot(partial: Partial<AccountSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...partial,
    configured: Boolean(getDerivAppId() || getDerivOAuthClientId()),
  };
  emit();
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}
