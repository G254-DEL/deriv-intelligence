import type { AccountKind } from "./types";

export function accountKindFromLoginid(
  loginid: string | null | undefined,
  isVirtual?: unknown,
): AccountKind {
  if (isVirtual === true || isVirtual === 1) {
    return "demo";
  }
  if (isVirtual === false || isVirtual === 0) {
    return "real";
  }
  const id = (loginid ?? "").toUpperCase();
  if (id.startsWith("VR") || id.startsWith("VRW") || id.startsWith("VRTC")) {
    return "demo";
  }
  if (id.startsWith("CR") || id.startsWith("MF") || id.startsWith("MLT")) {
    return "real";
  }
  return "unknown";
}

export function parseAuthorizePayload(payload: unknown): {
  loginid: string;
  currency: string;
  balance: number | null;
  kind: AccountKind;
  accounts: Array<{ loginid: string; currency: string; kind: AccountKind }>;
} | null {
  if (!isRecord(payload)) {
    return null;
  }
  const authorize = isRecord(payload.authorize)
    ? payload.authorize
    : payload;

  const loginid = readString(authorize.loginid);
  if (!loginid) {
    return null;
  }

  const currency = readString(authorize.currency) ?? "";
  const balance = readNumber(authorize.balance);
  const kind = accountKindFromLoginid(loginid, authorize.is_virtual);

  const accounts = parseAccountList(authorize.account_list, loginid, currency, kind);

  return { loginid, currency, balance, kind, accounts };
}

export function parseBalancePayload(payload: unknown): {
  loginid?: string;
  currency?: string;
  balance: number;
} | null {
  if (!isRecord(payload)) {
    return null;
  }
  const body = isRecord(payload.balance) ? payload.balance : payload;
  const balance = readNumber(body.balance);
  if (balance === null) {
    return null;
  }
  return {
    loginid: readString(body.loginid) ?? undefined,
    currency: readString(body.currency) ?? undefined,
    balance,
  };
}

function parseAccountList(
  value: unknown,
  fallbackLoginid: string,
  fallbackCurrency: string,
  fallbackKind: AccountKind,
): Array<{ loginid: string; currency: string; kind: AccountKind }> {
  if (!Array.isArray(value)) {
    return [
      {
        loginid: fallbackLoginid,
        currency: fallbackCurrency,
        kind: fallbackKind,
      },
    ];
  }

  const accounts: Array<{
    loginid: string;
    currency: string;
    kind: AccountKind;
  }> = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const loginid = readString(item.loginid);
    if (!loginid) {
      continue;
    }
    accounts.push({
      loginid,
      currency: readString(item.currency) ?? "",
      kind: accountKindFromLoginid(loginid, item.is_virtual),
    });
  }

  if (accounts.length === 0) {
    return [
      {
        loginid: fallbackLoginid,
        currency: fallbackCurrency,
        kind: fallbackKind,
      },
    ];
  }

  return accounts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
