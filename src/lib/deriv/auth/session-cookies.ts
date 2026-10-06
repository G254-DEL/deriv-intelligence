import { NextResponse } from "next/server";
import {
  OAUTH_ACCESS_COOKIE,
  SELECTED_LOGINID_COOKIE,
} from "./config";

const COOKIE_PATH = "/";

export function readCookieValue(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function appendHttpOnlyCookie(
  response: NextResponse,
  name: string,
  value: string,
  maxAge: number,
): void {
  response.cookies.set({
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge,
  });
}

export function appendClearedCookie(response: NextResponse, name: string): void {
  response.cookies.set({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: COOKIE_PATH,
    maxAge: 0,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  appendClearedCookie(response, OAUTH_ACCESS_COOKIE);
  appendClearedCookie(response, SELECTED_LOGINID_COOKIE);
}
