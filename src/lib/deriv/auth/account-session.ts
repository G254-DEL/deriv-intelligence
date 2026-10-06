import {
  type BrowserAccountPayload,
  type PrivateConnectionState,
} from "./account-selection";
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
import { clearPersistedSession } from "./session-store";
import type { AccountSnapshot, AuthConnectionStatus } from "./types";

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
let started = false;
let pollTimer: number | null = null;

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
  clearPersistedSession();
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
  startPolling();
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

export async function selectDerivAccount(loginid: string): Promise<void> {
  updateSnapshot({
    status: "connecting",
    detail: "Connecting to the selected Deriv account…",
    loginid,
    balance: null,
  });
  try {
    const response = await fetch("/api/deriv/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ loginid }),
    });
    applyServerPayload((await response.json()) as BrowserAccountPayload);
  } catch {
    updateSnapshot({
      status: "error",
      detail: "Could not select that Deriv account.",
      balance: null,
    });
  }
}

export async function signOutDerivAccount(): Promise<void> {
  clearPersistedSession();
  clearPkceSession();
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
    clearPersistedSession();
    clearPkceSession();
    updateSnapshot({
      status: "error",
      detail: "Legacy token login is disabled. Sign in with Deriv OAuth.",
    });
    return;
  }

  if (parsed.type === "oauth2_code") {
    await exchangeOAuth2Code(parsed.code, parsed.state);
    return;
  }

  await refreshFromServer();
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
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      updateSnapshot({
        status: "error",
        detail: body.error ?? "Token exchange failed.",
      });
      return;
    }
    await refreshFromServer();
  } catch {
    updateSnapshot({
      status: "error",
      detail: "Could not complete Deriv OAuth token exchange.",
    });
  }
}

async function refreshFromServer(): Promise<void> {
  try {
    const response = await fetch("/api/deriv/account", { cache: "no-store" });
    applyServerPayload((await response.json()) as BrowserAccountPayload);
  } catch {
    if (snapshot.status === "signed_out" || snapshot.status === "unconfigured") {
      return;
    }
    updateSnapshot({
      status: "error",
      detail: "Could not restore the Deriv account session.",
    });
  }
}

function applyServerPayload(body: BrowserAccountPayload): void {
  const configured = Boolean(getDerivAppId() || getDerivOAuthClientId());
  if (!body.authenticated) {
    snapshot = {
      ...signedOut,
      configured,
      status: configured ? "signed_out" : "unconfigured",
      detail: body.detail,
    };
    emit();
    return;
  }

  if (body.selectionRequired || !body.connection) {
    updateSnapshot({
      status: "select_account",
      detail: body.detail ?? "Choose a Deriv account.",
      loginid: null,
      currency: null,
      balance: null,
      kind: null,
      accounts: body.accounts,
    });
    return;
  }

  updateSnapshot({
    status: mapConnectionStatus(body.connection),
    detail: body.connection.detail ?? body.detail,
    loginid: body.connection.loginid,
    currency: body.connection.currency,
    balance: body.connection.balance,
    kind: body.connection.kind,
    accounts: body.accounts,
  });
}

function mapConnectionStatus(connection: PrivateConnectionState): AuthConnectionStatus {
  if (connection.status === "authenticated") {
    return "authenticated";
  }
  if (connection.status === "authenticating") {
    return "authenticating";
  }
  if (connection.status === "connecting") {
    return "connecting";
  }
  return "error";
}

function startPolling(): void {
  if (pollTimer !== null) {
    return;
  }
  pollTimer = window.setInterval(() => {
    if (
      snapshot.status === "signed_out" ||
      snapshot.status === "unconfigured" ||
      snapshot.status === "select_account"
    ) {
      return;
    }
    void refreshFromServer();
  }, 4_000);
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
