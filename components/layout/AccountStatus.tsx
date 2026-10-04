"use client";

import { useSyncExternalStore } from "react";
import {
  getAccountSnapshot,
  signInToDerivAccount,
  signOutDerivAccount,
  subscribeAccountSnapshot,
} from "@/src/lib/deriv/auth/account-session";
import type { AccountSnapshot } from "@/src/lib/deriv/auth/types";

function subscribe(listener: () => void) {
  return subscribeAccountSnapshot(listener);
}

export function AccountStatus() {
  const account = useSyncExternalStore(
    subscribe,
    getAccountSnapshot,
    getAccountSnapshot,
  );

  return (
    <div className="flex items-center gap-2 border-l border-border pl-3 sm:pl-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-raised text-xs font-medium text-muted">
        {initials(account)}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="text-xs font-medium text-foreground">Account</p>
        <p className="truncate text-[11px] text-muted">{statusLine(account)}</p>
      </div>
      <AccountAction account={account} />
    </div>
  );
}

function AccountAction({ account }: { account: AccountSnapshot }) {
  if (account.status === "authenticated") {
    return (
      <button
        type="button"
        onClick={() => {
          void signOutDerivAccount();
        }}
        className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground"
      >
        Log out
      </button>
    );
  }

  const busy =
    account.status === "connecting" || account.status === "authenticating";

  return (
    <button
      type="button"
      onClick={() => {
        void signInToDerivAccount();
      }}
      disabled={busy || account.status === "unconfigured"}
      title={
        account.status === "unconfigured"
          ? "Set NEXT_PUBLIC_DERIV_APP_ID to enable Deriv login"
          : undefined
      }
      className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground disabled:text-muted"
    >
      {busy ? "Connecting" : "Sign in"}
    </button>
  );
}

function initials(account: AccountSnapshot): string {
  const loginid = account.loginid ?? "";
  if (loginid.length >= 2) {
    return loginid.slice(0, 2).toUpperCase();
  }
  return "DI";
}

function statusLine(account: AccountSnapshot): string {
  if (account.status === "unconfigured") {
    return "Login not configured";
  }
  if (account.status === "connecting" || account.status === "authenticating") {
    return account.detail ?? "Connecting…";
  }
  if (account.status === "error") {
    return account.detail ?? "Account connection error";
  }
  if (account.status !== "authenticated" || !account.loginid) {
    return "Not signed in";
  }

  const kind =
    account.kind === "demo"
      ? "Demo"
      : account.kind === "real"
        ? "Real"
        : "Account";
  const balance =
    account.balance !== null && account.currency
      ? ` · ${formatBalance(account.balance)} ${account.currency}`
      : account.currency
        ? ` · ${account.currency}`
        : "";
  return `${kind} ${account.loginid}${balance}`;
}

function formatBalance(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
