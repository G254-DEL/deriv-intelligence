"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeDigitBias, type DigitAnalysis } from "@/src/lib/strategy/digit-bias";
import {
  MAX_LIVE_TICK_STREAMS,
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketTickSnapshot,
  type PublicMarketDataClient,
} from "@/src/lib/deriv";

const DASHBOARD_STREAM_LIMIT = 8;

const PREFERRED_SYMBOLS = [
  "R_10",
  "R_25",
  "R_50",
  "R_75",
  "R_100",
  "1HZ10V",
  "1HZ25V",
  "1HZ50V",
  "1HZ75V",
  "1HZ100V",
];

export type DashboardOpportunity = {
  symbol: string;
  market: string;
  strategy: string;
  currentDigit: string;
  price: string;
  tickStatus: string;
  entryState: DigitAnalysis["state"] | "WAITING";
  lastUpdated: string;
  dominantDigit: number | null;
  dominantFrequency: number | null;
  sampleSize: number;
};

export type DashboardLiveFeed = {
  connectionState: DerivConnectionState;
  statusDetail: string | null;
  activeMarketCount: number;
  liveTickCount: number;
  setupsDetected: number;
  entrySignals: number;
  opportunities: DashboardOpportunity[];
  featured: DashboardOpportunity | null;
};

export function useDashboardLiveFeed(): DashboardLiveFeed {
  const clientRef = useRef<PublicMarketDataClient | null>(null);
  const mountedRef = useRef(true);
  const [connectionState, setConnectionState] =
    useState<DerivConnectionState>("disconnected");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<DerivActiveSymbol[]>([]);
  const [marketTicks, setMarketTicks] = useState<Record<string, MarketTickSnapshot>>(
    {},
  );
  const [digitHistory, setDigitHistory] = useState<Record<string, number[]>>({});
  const lastDigitEpochRef = useRef<Record<string, number>>({});

  useEffect(() => {
    mountedRef.current = true;
    const session = retainPublicMarketData({
      onConnectionChange: (state, detail) => {
        if (!mountedRef.current) {
          return;
        }
        setConnectionState(state);
        setStatusDetail(detail ?? null);
        if (state === "disconnected") {
          setMarketTicks({});
          setDigitHistory({});
          lastDigitEpochRef.current = {};
        }
      },
      onActiveSymbols: (nextSymbols) => {
        if (!mountedRef.current) {
          return;
        }
        setSymbols(nextSymbols);
      },
      onMarketTick: (snapshot) => {
        if (!mountedRef.current) {
          return;
        }
        setMarketTicks((current) => ({
          ...current,
          [snapshot.symbol]: snapshot,
        }));

        if (snapshot.status !== "live") {
          return;
        }

        const digit = parseValidDigit(snapshot.digit);
        if (digit === null) {
          return;
        }

        if (
          snapshot.epoch > 0 &&
          lastDigitEpochRef.current[snapshot.symbol] === snapshot.epoch
        ) {
          return;
        }
        lastDigitEpochRef.current[snapshot.symbol] = snapshot.epoch;

        setDigitHistory((current) => {
          const previous = current[snapshot.symbol] ?? [];
          return {
            ...current,
            [snapshot.symbol]: [...previous, digit].slice(-20),
          };
        });
      },
      onTickStatus: (symbol, status) => {
        if (!mountedRef.current) {
          return;
        }
        setMarketTicks((current) => {
          const existing = current[symbol];
          if (!existing) {
            return current;
          }
          if (existing.status === status) {
            return current;
          }
          return {
            ...current,
            [symbol]: { ...existing, status },
          };
        });
      },
    });
    clientRef.current = session.client;
    return () => {
      mountedRef.current = false;
      clientRef.current = null;
      session.release();
    };
  }, []);

  const watchedSymbols = useMemo(
    () => pickDashboardSymbols(symbols, DASHBOARD_STREAM_LIMIT),
    [symbols],
  );

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected") {
      return;
    }
    const handle = window.setTimeout(() => {
      client.setTickSubscriptions(
        watchedSymbols.slice(0, MAX_LIVE_TICK_STREAMS),
      );
    }, 200);
    return () => window.clearTimeout(handle);
  }, [connectionState, watchedSymbols]);

  const opportunities = useMemo(() => {
    return watchedSymbols.map((code) => {
      const meta = symbols.find((item) => item.underlying_symbol === code);
      const tick = marketTicks[code];
      const analysis = analyzeDigitBias(digitHistory[code] ?? []);
      const live = tick?.status === "live";
      return {
        symbol: code,
        market: meta?.underlying_symbol_name ?? code,
        strategy: analysis.strategy,
        currentDigit: tick?.digit || "—",
        price: tick?.formattedPrice || "—",
        tickStatus: tickStatusLabel(tick),
        entryState: live || (digitHistory[code]?.length ?? 0) > 0
          ? analysis.state
          : "WAITING",
        lastUpdated: tick
          ? formatTickTime(tick.epoch, tick.receivedAt)
          : "Waiting for ticks",
        dominantDigit: analysis.dominantDigit,
        dominantFrequency: analysis.dominantFrequency,
        sampleSize: analysis.sampleSize,
      } satisfies DashboardOpportunity;
    });
  }, [digitHistory, marketTicks, symbols, watchedSymbols]);

  const setupsDetected = opportunities.filter(
    (row) => row.entryState === "MONITORING" || row.entryState === "SIGNAL",
  ).length;
  const entrySignals = opportunities.filter(
    (row) => row.entryState === "SIGNAL",
  ).length;
  const liveTickCount = opportunities.filter(
    (row) => row.tickStatus === "LIVE",
  ).length;
  const featured =
    opportunities.find((row) => row.entryState === "SIGNAL") ??
    opportunities.find((row) => row.tickStatus === "LIVE") ??
    opportunities[0] ??
    null;

  return {
    connectionState,
    statusDetail,
    activeMarketCount: watchedSymbols.length,
    liveTickCount,
    setupsDetected,
    entrySignals,
    opportunities,
    featured,
  };
}

function pickDashboardSymbols(
  symbols: DerivActiveSymbol[],
  max: number,
): string[] {
  if (symbols.length === 0) {
    return [];
  }
  const available = new Set(symbols.map((item) => item.underlying_symbol));
  const picked: string[] = [];
  for (const code of PREFERRED_SYMBOLS) {
    if (picked.length >= max) {
      break;
    }
    if (available.has(code)) {
      picked.push(code);
    }
  }
  if (picked.length >= max) {
    return picked;
  }
  const synthetics = symbols.filter(
    (item) => item.category === "synthetic_index" || item.market === "synthetic_index",
  );
  const rest = [...synthetics, ...symbols];
  for (const item of rest) {
    if (picked.length >= max) {
      break;
    }
    if (!picked.includes(item.underlying_symbol)) {
      picked.push(item.underlying_symbol);
    }
  }
  return picked;
}

function parseValidDigit(value: string | number | undefined | null): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 9) {
      return null;
    }
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[0-9]$/.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

function tickStatusLabel(tick: MarketTickSnapshot | undefined): string {
  if (!tick) {
    return "Waiting";
  }
  if (tick.status === "live") {
    return "LIVE";
  }
  if (tick.status === "connecting") {
    return "CONNECTING";
  }
  if (tick.status === "stale") {
    return "STALE";
  }
  return "ERROR";
}

function formatTickTime(epoch: number, receivedAt: number): string {
  const ms = epoch > 0 ? epoch * 1000 : receivedAt;
  return new Date(ms).toLocaleTimeString();
}
