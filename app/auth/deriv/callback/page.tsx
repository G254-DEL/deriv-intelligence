"use client";

import { useEffect } from "react";
import { startAccountSession } from "@/src/lib/deriv/auth/account-session";

export default function DerivAuthCallbackPage() {
  useEffect(() => {
    startAccountSession();
  }, []);

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
        Account
      </p>
      <h2 className="mt-1 text-lg font-semibold text-foreground">
        Completing Deriv sign-in
      </h2>
      <p className="mt-2 text-sm text-muted">
        Account tokens are handled in this tab only. Public market-data stays on
        a separate unauthenticated connection.
      </p>
    </div>
  );
}
