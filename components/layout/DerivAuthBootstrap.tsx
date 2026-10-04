"use client";

import { useEffect } from "react";
import { startAccountSession } from "@/src/lib/deriv/auth/account-session";

export function DerivAuthBootstrap() {
  useEffect(() => {
    startAccountSession();
  }, []);

  return null;
}
