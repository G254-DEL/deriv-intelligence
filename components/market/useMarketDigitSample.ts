"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketTickSnapshot,
} from "@/src/lib/deriv";
import { extractLastDisplayedDigit } from "@/src/lib/digits/extract-last-digit";
import type { Tick } from "@/src/lib/deriv/types";

export type SampleTick = {
  quote: number | string;
  epoch: number;
  digit: number;
};

export function useMarketDigitSample(count: number) {
  const mountedRef = useRef(true);
  const clientRef = useRef<ReturnType<typeof retainPublicMarketData>["client"] | null>(
    null,
  );
  const symbolRef = useRef("R_10");
  const countRef = useRef(count);
  const lastEpochRef = useRef<number | null>(null);
  const [connectionState, setConnectionState] =
    useState<DerivConnectionState>("disconnected");
  const [symbols, setSymbols] = useState<DerivActiveSymbol[]>([]);
  const [symbol, setSymbol] = useState("R_10");
  const [ticks, setTicks] = useState<SampleTick[]>([]);
  const [latest, setLatest] = useState<MarketTickSnapshot | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const session = retainPublicMarketData({
      onConnectionChange: (state) => {
        if (!mountedRef.current) {
          return;
        }
        setConnectionState(state);
      },
      onActiveSymbols: (next) => {
        if (!mountedRef.current) {
          return;
        }
        setSymbols(next);
        setSymbol((current) => {
          if (next.some((item) => item.underlying_symbol === current)) {
            return current;
          }
          return next[0]?.underlying_symbol ?? current;
        });
      },
      onMarketTick: (snapshot) => {
        if (!mountedRef.current || snapshot.symbol !== symbolRef.current) {
          return;
        }
        setLatest(snapshot);
        const digit = Number(snapshot.digit);
        if (!Number.isInteger(digit) || snapshot.status !== "live") {
          return;
        }
        if (snapshot.epoch > 0 && lastEpochRef.current === snapshot.epoch) {
          return;
        }
        lastEpochRef.current = snapshot.epoch;
        setTicks((current) =>
          [
            ...current,
            { quote: snapshot.quote, epoch: snapshot.epoch, digit },
          ].slice(-countRef.current),
        );
      },
    });
    clientRef.current = session.client;
    return () => {
      mountedRef.current = false;
      session.release();
    };
  }, []);

  symbolRef.current = symbol;
  countRef.current = count;

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected" || !symbol) {
      return;
    }
    client.setTickSubscriptions([symbol]);
    lastEpochRef.current = null;
    setTicks([]);
    setLatest(null);
    setHistoryError(null);
    void client
      .requestTicksHistory({
        ticks_history: symbol,
        end: "latest",
        style: "ticks",
        count,
      })
      .then((history) => {
        if (!mountedRef.current || symbolRef.current !== symbol) {
          return;
        }
        setTicks(historyToSample(history, count));
      })
      .catch(() => {
        if (mountedRef.current) {
          setHistoryError("Could not load tick history. Live ticks will still fill in.");
        }
      });
  }, [connectionState, symbol, count]);

  const digits = useMemo(() => ticks.map((tick) => tick.digit), [ticks]);

  return {
    connectionState,
    symbols,
    symbol,
    setSymbol,
    ticks,
    digits,
    latest,
    historyError,
    getClient: () => clientRef.current,
  };
}

function historyToSample(history: Tick[], count: number): SampleTick[] {
  const samples: SampleTick[] = [];
  for (const tick of history) {
    const extracted = extractLastDisplayedDigit(tick.quote);
    const digit = extracted ? Number(extracted.digit) : Number.NaN;
    if (!Number.isInteger(digit)) {
      continue;
    }
    samples.push({ quote: tick.quote, epoch: tick.epoch, digit });
  }
  return samples.slice(-count);
}
