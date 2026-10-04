"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  connectionLabel,
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketTickSnapshot,
  type PublicMarketDataClient,
} from "@/src/lib/deriv";
import {
  evaluateEntryMap,
  type EntryMapStatus,
} from "@/src/lib/strategy/entry-map";

const STRATEGIES = ["Under 7", "Over 2", "Over 3", "Under 8", "Matches"] as const;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const HISTORY_LIMIT = 30;

const STATUS_DOT: Record<DerivConnectionState, string> = {
  connected: "bg-accent",
  connecting: "bg-warning",
  disconnected: "bg-muted",
  error: "bg-warning",
};

const ENTRY_STATUS_CLASS: Record<EntryMapStatus, string> = {
  WAITING: "text-muted",
  TRIGGERED: "text-warning",
  CONFIRMING: "text-warning",
  SIGNAL: "text-foreground",
};

function pickPreferredSymbol(symbols: DerivActiveSymbol[]): string {
  if (symbols.length === 0) {
    return "";
  }

  const preferred =
    symbols.find((item) => item.underlying_symbol === "1HZ100V") ??
    symbols.find((item) => item.market === "synthetic_index") ??
    symbols[0];

  return preferred.underlying_symbol;
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

export function EntryMapsView() {
  const clientRef = useRef<PublicMarketDataClient | null>(null);
  const mountedRef = useRef(true);
  const lastEpochRef = useRef<number | null>(null);
  const selectedSymbolRef = useRef("");

  const [connectionState, setConnectionState] =
    useState<DerivConnectionState>("disconnected");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<DerivActiveSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const resolvedSymbol = selectedSymbol || pickPreferredSymbol(symbols);
  const [strategy, setStrategy] = useState<(typeof STRATEGIES)[number]>("Under 7");
  const [triggerDigit, setTriggerDigit] = useState(4);
  const [confirmA, setConfirmA] = useState(5);
  const [confirmB, setConfirmB] = useState(6);
  const [latestTick, setLatestTick] = useState<MarketTickSnapshot | null>(null);
  const [digits, setDigits] = useState<number[]>([]);

  useEffect(() => {
    selectedSymbolRef.current = resolvedSymbol;
  }, [resolvedSymbol]);

  useEffect(() => {
    mountedRef.current = true;
    const session = retainPublicMarketData({
      onConnectionChange: (state, detail) => {
        if (!mountedRef.current) {
          return;
        }
        setConnectionState(state);
        setStatusDetail(detail ?? null);
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
        const watched = selectedSymbolRef.current;
        if (watched && snapshot.symbol !== watched) {
          return;
        }
        if (snapshot.status !== "live") {
          setLatestTick(snapshot);
          return;
        }

        setLatestTick(snapshot);
        const digit = parseValidDigit(snapshot.digit);
        if (digit === null) {
          return;
        }
        if (snapshot.epoch > 0 && lastEpochRef.current === snapshot.epoch) {
          return;
        }
        lastEpochRef.current = snapshot.epoch;
        setDigits((current) => [...current, digit].slice(-HISTORY_LIMIT));
      },
      onError: (message) => {
        if (!mountedRef.current) {
          return;
        }
        setStatusDetail(message);
      },
    });

    clientRef.current = session.client;

    return () => {
      mountedRef.current = false;
      session.release();
      if (clientRef.current === session.client) {
        clientRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected" || !resolvedSymbol) {
      return;
    }

    lastEpochRef.current = null;
    setDigits([]);
    setLatestTick(null);
    client.setTickSubscriptions([resolvedSymbol], "entry-maps");
    return () => {
      client.releaseTickSubscriptions("entry-maps");
    };
  }, [connectionState, resolvedSymbol]);

  const evaluation = useMemo(
    () =>
      evaluateEntryMap(digits, {
        triggerDigit,
        confirmation: [confirmA, confirmB],
      }),
    [confirmA, confirmB, digits, triggerDigit],
  );

  const selectedMeta = symbols.find(
    (item) => item.underlying_symbol === resolvedSymbol,
  );
  const currentDigit = parseValidDigit(latestTick?.digit);
  const patternLabel = evaluation.pattern.join(" → ");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Conditions
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Entry Maps
          </h2>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[connectionState]}`}
            aria-hidden
          />
          <span className="font-medium text-foreground">
            {connectionLabel(connectionState)}
          </span>
        </div>
      </div>

      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground">
        Entry maps define the consecutive digits that must appear before a
        strategy can show an entry signal. They do not guarantee the next
        market outcome. Automatic trading stays off.
      </p>

      {statusDetail && connectionState !== "connected" ? (
        <p className="text-sm text-muted">{statusDetail}</p>
      ) : null}

      <Card title="Entry conditions" badge="Configurable">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
              Market
            </span>
            <select
              value={resolvedSymbol}
              onChange={(event) => setSelectedSymbol(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
            >
              {symbols.length === 0 ? (
                <option value="">Waiting for markets…</option>
              ) : (
                symbols.map((item) => (
                  <option
                    key={item.underlying_symbol}
                    value={item.underlying_symbol}
                  >
                    {item.underlying_symbol_name ?? item.underlying_symbol}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
              Strategy
            </span>
            <select
              value={strategy}
              onChange={(event) =>
                setStrategy(event.target.value as (typeof STRATEGIES)[number])
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
            >
              {STRATEGIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
              Trigger digit
            </span>
            <select
              value={triggerDigit}
              onChange={(event) => setTriggerDigit(Number(event.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none"
            >
              {DIGITS.map((digit) => (
                <option key={digit} value={digit}>
                  {digit}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
                Confirm 1
              </span>
              <select
                value={confirmA}
                onChange={(event) => setConfirmA(Number(event.target.value))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none"
              >
                {DIGITS.map((digit) => (
                  <option key={digit} value={digit}>
                    {digit}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
                Confirm 2
              </span>
              <select
                value={confirmB}
                onChange={(event) => setConfirmB(Number(event.target.value))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none"
              >
                {DIGITS.map((digit) => (
                  <option key={digit} value={digit}>
                    {digit}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted">
          Required sequence:{" "}
          <span className="font-mono text-foreground">{patternLabel}</span>
          . Strategy {strategy} is shown for mapping only and does not place
          trades.
        </p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Live digit" badge={connectionState === "connected" ? "Live" : "Idle"}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">
                Market
              </dt>
              <dd className="mt-1 text-sm text-foreground">
                {selectedMeta?.underlying_symbol_name ?? resolvedSymbol ?? "—"}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">
                Symbol
              </dt>
              <dd className="mt-1 font-mono text-sm text-foreground">
                {resolvedSymbol || "—"}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">
                Current price
              </dt>
              <dd className="mt-1 font-mono text-sm text-foreground">
                {latestTick?.formattedPrice ?? "—"}
              </dd>
            </div>
            <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
              <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">
                Current digit
              </dt>
              <dd className="mt-1 font-mono text-2xl text-foreground">
                {currentDigit ?? "—"}
              </dd>
            </div>
          </dl>
        </Card>

        <Card
          title="Entry state"
          badge={evaluation.status}
        >
          <div className="flex flex-col gap-4">
            <p className={`text-2xl font-semibold tracking-tight ${ENTRY_STATUS_CLASS[evaluation.status]}`}>
              {evaluation.status}
            </p>
            <p className="text-sm leading-6 text-muted">
              {statusDescription(evaluation.status, patternLabel, evaluation.matchedLength)}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
                  Pattern progress
                </div>
                <div className="mt-1 font-mono text-sm text-foreground">
                  {evaluation.matchedLength}/{evaluation.pattern.length}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
                  Consecutive run
                </div>
                <div className="mt-1 font-mono text-sm text-foreground">
                  {evaluation.consecutive.digit === null
                    ? "—"
                    : `${evaluation.consecutive.count}× digit ${evaluation.consecutive.digit}`}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Recent digits">
        {digits.length === 0 ? (
          <p className="text-sm text-muted">
            Waiting for live ticks on the selected market.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-2">
            {digits.map((digit, index) => {
              const fromEnd = digits.length - index;
              const inMatch =
                evaluation.matchedLength > 0 &&
                fromEnd <= evaluation.matchedLength;
              return (
                <li
                  key={`${index}-${digit}`}
                  className={`flex h-9 w-9 items-center justify-center rounded-md border font-mono text-sm ${
                    inMatch
                      ? "border-accent text-foreground"
                      : "border-border text-muted"
                  }`}
                >
                  {digit}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}

function statusDescription(
  status: EntryMapStatus,
  patternLabel: string,
  matchedLength: number,
): string {
  switch (status) {
    case "SIGNAL":
      return `The consecutive sequence ${patternLabel} has completed. This is a map state only, not a trade.`;
    case "CONFIRMING":
      return `Trigger seen. ${matchedLength} digit(s) of ${patternLabel} match so far. Waiting for the rest of the confirmation.`;
    case "TRIGGERED":
      return `Trigger digit matched. Waiting for the confirmation digits in ${patternLabel}.`;
    default:
      return `Waiting for the sequence ${patternLabel} to begin.`;
  }
}
