import { DERIV_REST_ACCOUNTS_URL } from "./config";
import { accountKindFromLoginid } from "./parse-account";
import type { AccountKind } from "./types";

export type RestAccount = {
  loginid: string;
  currency: string;
  kind: AccountKind;
  balance: number | null;
};

export async function fetchDerivRestAccounts(
  accessToken: string,
): Promise<RestAccount[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(DERIV_REST_ACCOUNTS_URL, { headers });
  if (!response.ok) {
    return [];
  }
  return parseRestAccounts(await response.json());
}

export function parseRestAccounts(payload: unknown): RestAccount[] {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const list = Array.isArray(record.data)
    ? record.data
    : isRecord(record.data) && Array.isArray(record.data.accounts)
      ? record.data.accounts
      : Array.isArray(record.accounts)
        ? record.accounts
        : [];

  const accounts: RestAccount[] = [];
  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }
    const loginid =
      readString(item.loginid) ??
      readString(item.account_id) ??
      readString(item.id);
    if (!loginid) {
      continue;
    }
    const balanceValue = item.balance;
    const nestedBalance = isRecord(balanceValue)
      ? Number(balanceValue.amount ?? balanceValue.balance)
      : Number(balanceValue);
    accounts.push({
      loginid,
      currency:
        readString(item.currency) ??
        (isRecord(balanceValue) ? readString(balanceValue.currency) : null) ??
        "",
      kind: accountKindFromLoginid(loginid, item.is_virtual ?? item.virtual),
      balance: Number.isFinite(nestedBalance) ? nestedBalance : null,
    });
  }
  return accounts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
