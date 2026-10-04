import { SESSION_STORAGE_KEY } from "./config";
import type { OAuthAccountToken } from "./types";

export type PersistedAccountSession = {
  accounts: OAuthAccountToken[];
  selectedLoginid: string;
};

export function loadPersistedSession(): PersistedAccountSession | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAccountSession>;
    if (
      !Array.isArray(parsed.accounts) ||
      typeof parsed.selectedLoginid !== "string"
    ) {
      return null;
    }
    const accounts = parsed.accounts.filter(isAccountToken);
    if (accounts.length === 0) {
      return null;
    }
    return {
      accounts,
      selectedLoginid: parsed.selectedLoginid,
    };
  } catch {
    return null;
  }
}

export function savePersistedSession(session: PersistedAccountSession): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearPersistedSession(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function isAccountToken(value: unknown): value is OAuthAccountToken {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<OAuthAccountToken>;
  return (
    typeof item.loginid === "string" &&
    item.loginid.length > 0 &&
    typeof item.token === "string" &&
    item.token.length > 0 &&
    typeof item.currency === "string"
  );
}
