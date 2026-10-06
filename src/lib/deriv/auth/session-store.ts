import { SESSION_STORAGE_KEY } from "./config";

/**
 * Legacy API tokens are not persisted.
 * Account selection is an httpOnly loginid cookie, and the OAuth access
 * token stays in its own httpOnly cookie.
 */
export function loadPersistedSession(): null {
  clearPersistedSession();
  return null;
}

export function savePersistedSession(): void {
  clearPersistedSession();
}

export function clearPersistedSession(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}
