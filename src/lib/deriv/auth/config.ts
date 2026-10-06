export const DERIV_OAUTH_AUTHORIZE_URL =
  "https://oauth.deriv.com/oauth2/authorize";
export const DERIV_OAUTH2_AUTH_URL = "https://auth.deriv.com/oauth2/auth";
export const DERIV_OAUTH2_TOKEN_URL = "https://auth.deriv.com/oauth2/token";
export const DERIV_AUTHENTICATED_WS_URL =
  "wss://ws.derivws.com/websockets/v3";
export const DERIV_REST_ACCOUNTS_URL =
  "https://api.derivws.com/trading/v1/options/accounts";

export const ENV_DERIV_APP_ID = "NEXT_PUBLIC_DERIV_APP_ID";
export const ENV_DERIV_OAUTH_CLIENT_ID = "NEXT_PUBLIC_DERIV_OAUTH_CLIENT_ID";
export const ENV_DERIV_OAUTH_REDIRECT_URI =
  "NEXT_PUBLIC_DERIV_OAUTH_REDIRECT_URI";

const SESSION_STORAGE_KEY = "deriv.intelligence.account.session";
const PKCE_STORAGE_KEY = "deriv.intelligence.oauth.pkce";

export const OAUTH_ACCESS_COOKIE = "deriv_oauth_at";
export const SELECTED_LOGINID_COOKIE = "deriv_selected_loginid";

export function getDerivAppId(): string | null {
  const value = process.env.NEXT_PUBLIC_DERIV_APP_ID?.trim();
  return value ? value : null;
}

export function getDerivOAuthClientId(): string | null {
  const value = process.env.NEXT_PUBLIC_DERIV_OAUTH_CLIENT_ID?.trim();
  return value ? value : null;
}

export function getDerivOAuthRedirectUri(): string | null {
  const configured = process.env.NEXT_PUBLIC_DERIV_OAUTH_REDIRECT_URI?.trim();
  if (configured) {
    return configured;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/deriv/callback`;
  }
  return null;
}

export function authenticatedWebSocketUrl(appId: string): string {
  return `${DERIV_AUTHENTICATED_WS_URL}?app_id=${encodeURIComponent(appId)}`;
}

export { SESSION_STORAGE_KEY, PKCE_STORAGE_KEY };
