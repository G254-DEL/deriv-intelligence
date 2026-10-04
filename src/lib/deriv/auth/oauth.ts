import {
  DERIV_OAUTH2_AUTH_URL,
  DERIV_OAUTH_AUTHORIZE_URL,
  PKCE_STORAGE_KEY,
  getDerivAppId,
  getDerivOAuthClientId,
  getDerivOAuthRedirectUri,
} from "./config";
import type { OAuthAccountToken, ParsedOAuthRedirect } from "./types";

export type PkceSession = {
  verifier: string;
  state: string;
};

export function parseOAuthRedirectSearch(
  search: string,
): ParsedOAuthRedirect {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );

  const oauthError =
    params.get("error_description") ?? params.get("error");
  if (oauthError) {
    return { type: "error", message: oauthError };
  }

  const code = params.get("code");
  const state = params.get("state");
  if (code && state) {
    return { type: "oauth2_code", code, state };
  }

  const accounts = parseLegacyAccountTokens(params);
  if (accounts.length > 0) {
    return { type: "legacy_tokens", accounts };
  }

  return { type: "none" };
}

export function parseLegacyAccountTokens(
  params: URLSearchParams,
): OAuthAccountToken[] {
  const accounts: OAuthAccountToken[] = [];

  for (let index = 1; index <= 20; index += 1) {
    const loginid = params.get(`acct${index}`);
    const token = params.get(`token${index}`);
    const currency = params.get(`cur${index}`) ?? "";
    if (!loginid || !token) {
      continue;
    }
    accounts.push({ loginid, token, currency });
  }

  return accounts;
}

export function stripOAuthParamsFromUrl(url: string): string {
  const parsed = new URL(url);
  const keys = [...parsed.searchParams.keys()];
  for (const key of keys) {
    if (
      key === "code" ||
      key === "state" ||
      key === "error" ||
      key === "error_description" ||
      /^acct\d+$/i.test(key) ||
      /^token\d+$/i.test(key) ||
      /^cur\d+$/i.test(key)
    ) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hash = "";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function createPkceSession(): Promise<PkceSession> {
  const verifier = randomVerifier();
  const state = randomHex(16);
  return { verifier, state };
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(hash);
}

export async function buildSignInUrl(): Promise<string> {
  const clientId = getDerivOAuthClientId();
  const appId = getDerivAppId();
  const redirectUri = getDerivOAuthRedirectUri();

  if (clientId && redirectUri) {
    const pkce = await createPkceSession();
    persistPkce(pkce);
    const challenge = await pkceChallenge(pkce.verifier);
    // URLSearchParams percent-encodes redirect_uri as http%3A%2F%2F...
    // auth.deriv.com's WAF treats encoded slashes as suspicious; keep : and /.
    return appendOAuth2AuthorizeQuery(DERIV_OAUTH2_AUTH_URL, [
      ["response_type", "code"],
      ["client_id", clientId],
      ["redirect_uri", redirectUri],
      ["scope", "trade"],
      ["state", pkce.state],
      ["code_challenge", challenge],
      ["code_challenge_method", "S256"],
    ]);
  }

  if (appId) {
    const url = new URL(DERIV_OAUTH_AUTHORIZE_URL);
    url.searchParams.set("app_id", appId);
    if (redirectUri) {
      url.searchParams.set("l", "EN");
    }
    return url.toString();
  }

  throw new Error("Deriv account login is not configured.");
}

export function readPkceSession(): PkceSession | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  const raw = sessionStorage.getItem(PKCE_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PkceSession>;
    if (
      typeof parsed.verifier === "string" &&
      typeof parsed.state === "string"
    ) {
      return { verifier: parsed.verifier, state: parsed.state };
    }
  } catch {
    return null;
  }
  return null;
}

export function clearPkceSession(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(PKCE_STORAGE_KEY);
}

function appendOAuth2AuthorizeQuery(
  base: string,
  pairs: ReadonlyArray<readonly [string, string]>,
): string {
  const query = pairs
    .map(([key, value]) => {
      const encodedValue =
        key === "redirect_uri" ? encodeURI(value) : encodeURIComponent(value);
      return `${encodeURIComponent(key)}=${encodedValue}`;
    })
    .join("&");
  return `${base}?${query}`;
}

function persistPkce(session: PkceSession): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(session));
}

function randomVerifier(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
}

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function base64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
