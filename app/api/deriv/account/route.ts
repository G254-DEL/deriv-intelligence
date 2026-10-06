import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  emptyPrivateConnection,
  resolveAccountSelection,
  toBrowserAccountPayload,
  type BrowserAccountPayload,
  type PrivateConnectionState,
} from "@/src/lib/deriv/auth/account-selection";
import {
  getDerivAppId,
  OAUTH_ACCESS_COOKIE,
  SELECTED_LOGINID_COOKIE,
} from "@/src/lib/deriv/auth/config";
import {
  ensurePrivateSession,
  releasePrivateSession,
} from "@/src/lib/deriv/auth/private-session";
import { fetchDerivRestAccountsResult } from "@/src/lib/deriv/auth/rest-accounts";
import {
  appendClearedCookie,
  appendHttpOnlyCookie,
  clearAuthCookies,
  readCookieValue,
} from "@/src/lib/deriv/auth/session-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECTION_MAX_AGE_SECONDS = 60 * 60;

export async function GET() {
  return handleAccountRequest(null, false);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      toBrowserAccountPayload({
        authenticated: false,
        accounts: [],
        selectionRequired: false,
        connection: null,
        detail: "Invalid account selection.",
      }),
      { status: 400 },
    );
  }
  const loginid =
    body && typeof body === "object" && "loginid" in body && typeof body.loginid === "string"
      ? body.loginid
      : "";
  return handleAccountRequest(loginid, true);
}

async function handleAccountRequest(
  requestedLoginid: string | null,
  force: boolean,
): Promise<NextResponse<BrowserAccountPayload>> {
  const jar = await cookies();
  const accessToken = readCookieValue(jar.get(OAUTH_ACCESS_COOKIE)?.value);
  if (!accessToken) {
    return NextResponse.json(
      toBrowserAccountPayload({
        authenticated: false,
        accounts: [],
        selectionRequired: false,
        connection: null,
        detail: null,
      }),
      { status: 401 },
    );
  }

  const lookedUp = await fetchDerivRestAccountsResult(accessToken);
  if (!lookedUp.ok) {
    releasePrivateSession(accessToken);
    const response = NextResponse.json(
      toBrowserAccountPayload({
        authenticated: false,
        accounts: [],
        selectionRequired: false,
        connection: null,
        detail: "Deriv session expired or account lookup failed.",
      }),
    );
    clearAuthCookies(response);
    return response;
  }

  const accounts = lookedUp.accounts;
  const cookieLoginid = readCookieValue(jar.get(SELECTED_LOGINID_COOKIE)?.value);
  let decision = resolveAccountSelection(
    accounts,
    force ? requestedLoginid : cookieLoginid,
  );
  let clearStaleSelection = false;
  if (!force && decision.type === "rejected") {
    clearStaleSelection = true;
    decision = resolveAccountSelection(accounts, null);
  }

  if (decision.type === "required") {
    const response = NextResponse.json(
      toBrowserAccountPayload({
        authenticated: true,
        accounts,
        selectionRequired: true,
        connection: null,
        detail: "Choose a Deriv account.",
      }),
    );
    if (clearStaleSelection) {
      appendClearedCookie(response, SELECTED_LOGINID_COOKIE);
    }
    return response;
  }

  if (decision.type === "rejected") {
    const response = NextResponse.json(
      toBrowserAccountPayload({
        authenticated: true,
        accounts,
        selectionRequired: accounts.length > 1,
        connection: null,
        detail: decision.reason,
      }),
      { status: 400 },
    );
    appendClearedCookie(response, SELECTED_LOGINID_COOKIE);
    return response;
  }

  const appId = getDerivAppId();
  let connection: PrivateConnectionState;
  if (!appId) {
    connection = {
      ...emptyPrivateConnection(),
      status: "error",
      loginid: decision.loginid,
      detail: "NEXT_PUBLIC_DERIV_APP_ID is required to authorize the selected account.",
    };
  } else {
    connection = await ensurePrivateSession({
      accessToken,
      appId,
      accounts,
      loginid: decision.loginid,
      force,
    });
  }

  const response = NextResponse.json(
    toBrowserAccountPayload({
      authenticated: true,
      accounts,
      selectionRequired: false,
      connection,
      detail: connection.detail,
    }),
  );
  appendHttpOnlyCookie(
    response,
    SELECTED_LOGINID_COOKIE,
    decision.loginid,
    SELECTION_MAX_AGE_SECONDS,
  );
  return response;
}
