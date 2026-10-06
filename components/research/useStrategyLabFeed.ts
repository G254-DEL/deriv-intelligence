"use client";

import { useEffect, useRef, useState } from "react";
import {
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketTickSnapshot,
} from "@/src/lib/deriv";
import type { LabObservation } from "@/src/lib/research/lab-store";

export function useStrategyLabFeed(
  symbol: string,
  onObservation: (observation: LabObservation) => void,
) {
  const [connectionState, setConnectionState] =
    useState<DerivConnectionState>("disconnected");
  const [symbols, setSymbols] = useState<DerivActiveSymbol[]>([]);
  const [latest, setLatest] = useState<MarketTickSnapshot | null>(null);
  const clientRef = useRef<ReturnType<typeof retainPublicMarketData>["client"] | null>(null);

  useEffect(() => {
    let disposed = false;
    const session = retainPublicMarketData({
      onConnectionChange: (state) => {
        if (!disposed) {
          setConnectionState(state);
        }
      },
      onActiveSymbols: (next) => {
        if (!disposed) {
          setSymbols(next);
        }
      },
      onMarketTick: (snapshot) => {
        if (disposed || snapshot.symbol !== symbol || snapshot.status !== "live") {
          return;
        }
        setLatest(snapshot);
        const digit = Number(snapshot.digit);
        if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
          return;
        }
        onObservation({
          symbol: snapshot.symbol,
          epoch: snapshot.epoch,
          quote: typeof snapshot.quote === "number" ? snapshot.quote : Number(snapshot.quote),
          lastDigit: digit,
        });
      },
    });
    clientRef.current = session.client;
    return () => {
      disposed = true;
      clientRef.current = null;
      session.release();
    };
  }, [onObservation, symbol]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected" || !symbol) {
      return;
    }
    const handle = window.setTimeout(() => {
      client.setTickSubscriptions([symbol], "strategy-lab");
    }, 200);
    return () => {
      window.clearTimeout(handle);
      client.releaseTickSubscriptions("strategy-lab");
    };
  }, [connectionState, symbol]);

  return { connectionState, symbols, latest };
}
