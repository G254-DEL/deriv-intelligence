import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchDerivRestAccounts } from "@/src/lib/deriv/auth/rest-accounts";

const COOKIE = "deriv_oauth_at";

export async function GET() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false, accounts: [] });
  }

  const accounts = await fetchDerivRestAccounts(token);
  return NextResponse.json({ authenticated: true, accounts });
}
