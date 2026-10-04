import { NextResponse } from "next/server";
import { DERIV_OAUTH2_TOKEN_URL } from "@/src/lib/deriv/auth/config";
import { fetchDerivRestAccounts } from "@/src/lib/deriv/auth/rest-accounts";

const COOKIE = "deriv_oauth_at";

export async function POST(request: Request) {
  const clientId = process.env.NEXT_PUBLIC_DERIV_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_DERIV_OAUTH_CLIENT_ID is not configured." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid token request." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid token request." }, { status: 400 });
  }

  const code = readString(body.code);
  const codeVerifier = readString(body.code_verifier);
  const redirectUri = readString(body.redirect_uri);

  if (!code || !codeVerifier || !redirectUri) {
    return NextResponse.json(
      { error: "code, code_verifier, and redirect_uri are required." },
      { status: 400 },
    );
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });

  try {
    const tokenResponse = await fetch(DERIV_OAUTH2_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const tokenBody = (await tokenResponse.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenResponse.ok || !tokenBody.access_token) {
      return NextResponse.json(
        {
          error:
            tokenBody.error_description ??
            tokenBody.error ??
            "Deriv token exchange failed.",
        },
        { status: 400 },
      );
    }

    const accounts = await fetchDerivRestAccounts(tokenBody.access_token);
    const response = NextResponse.json({
      authenticated: true,
      accounts,
    });
    response.cookies.set({
      name: COOKIE,
      value: tokenBody.access_token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: tokenBody.expires_in ?? 3600,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "Could not reach Deriv token endpoint." },
      { status: 502 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set({
    name: COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
