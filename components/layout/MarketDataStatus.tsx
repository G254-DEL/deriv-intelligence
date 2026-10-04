"use client";

import { useEffect, useState } from "react";
import {
  connectionLabel,
  retainPublicMarketData,
  type DerivConnectionState,
} from "@/src/lib/deriv";

const STATUS_DOT: Record<DerivConnectionState, string> = {
  connected: "bg-accent",
  connecting: "bg-warning",
  disconnected: "bg-muted",
  error: "bg-warning",
};

const SHORT_LABEL: Record<DerivConnectionState, string> = {
  connected: "Live",
  connecting: "Connecting",
  disconnected: "Disconnected",
  error: "Error",
};

export function MarketDataStatus({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [state, setState] = useState<DerivConnectionState>("disconnected");

  useEffect(() => {
    const session = retainPublicMarketData({
      onConnectionChange: (next) => {
        setState(next);
      },
    });
    return () => session.release();
  }, []);

  if (compact) {
    return (
      <span>
        {state === "connected"
          ? "Public market data · live"
          : connectionLabel(state).replace("Deriv Market Data: ", "Market data · ")}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs">
      <span
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[state]}`}
        aria-hidden
      />
      <span className="text-muted">Connection</span>
      <span className="font-medium text-foreground">{SHORT_LABEL[state]}</span>
    </div>
  );
}
