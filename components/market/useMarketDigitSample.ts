"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketTickSnapshot,
} from "@/src/lib/deriv";
import {
  decimalPlacesFromPipSize,
  extractLastDisplayedDigit,
} from "@/src/lib/digits/extract-last-digit";
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
  const symbolsRef = useRef<DerivActiveSymbol[]>([]);

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
  symbolsRef.current = symbols;

  const decimalPlaces = useMemo(() => {
    return decimalPlacesFromPipSize(pipSizeFor(symbols, symbol));
  }, [symbol, symbols]);

  const digits = useMemo(
    () =>
      ticks.flatMap((tick) => {
        const digit = displayedDigit(tick, decimalPlaces);
        return digit === null ? [] : [digit];
      }),
    [decimalPlaces, ticks],
  );

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected" || !symbol) {
      return;
    }
    client.setTickSubscriptions([symbol], "digit-sample");
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
        setTicks(
          historyToSample(
            history,
            count,
            decimalPlacesFromPipSize(pipSizeFor(symbolsRef.current, symbol)),
          ),
        );
      })
      .catch(() => {
        if (mountedRef.current) {
          setHistoryError("Could not load tick history. Live ticks will still fill in.");
        }
      });
    return () => {
      client.releaseTickSubscriptions("digit-sample");
    };
  }, [connectionState, symbol, count]);

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

function historyToSample(
  history: Tick[],
  count: number,
  decimalPlaces: number | undefined,
): SampleTick[] {
  const samples: SampleTick[] = [];
  for (const tick of history) {
    const extracted = extractLastDisplayedDigit(tick.quote, decimalPlaces);
    const digit = extracted ? Number(extracted.digit) : Number.NaN;
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
      continue;
    }
    samples.push({ quote: tick.quote, epoch: tick.epoch, digit });
  }
  return samples.slice(-count);
}

function pipSizeFor(symbols: DerivActiveSymbol[], symbol: string): number {
  return symbols.find((item) => item.underlying_symbol === symbol)?.pip_size ?? Number.NaN;
}

function displayedDigit(
  tick: SampleTick,
  decimalPlaces: number | undefined,
): number | null {
  if (typeof decimalPlaces === "number") {
    const extracted = extractLastDisplayedDigit(tick.quote, decimalPlaces);
    const digit = extracted ? Number(extracted.digit) : Number.NaN;
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9) {
      return digit;
    }
  }
  return Number.isInteger(tick.digit) && tick.digit >= 0 && tick.digit <= 9
    ? tick.digit
    : null;
}
