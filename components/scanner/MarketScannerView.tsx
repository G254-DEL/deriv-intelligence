"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { analyzeDigitBias } from "@/src/lib/strategy/digit-bias";
import {
  MARKET_CATEGORIES,
  MAX_LIVE_TICK_STREAMS,
  connectionLabel,
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketCategoryId,
  type MarketTickSnapshot,
  type PublicMarketDataClient,
} from "@/src/lib/deriv";

const SCANNER_NOTICE =
  "The scanner will use public Deriv market-data streams. No trading orders are placed from this page.";

const COLUMNS = [
  "Market",
  "Symbol",
  "Current Price",
  "Current Digit",
  "Tick Status",
  "Strategy",
  "Entry State",
  "Action",
];

const STATUS_DOT: Record<DerivConnectionState, string> = {
  connected: "bg-accent",
  connecting: "bg-warning",
  disconnected: "bg-muted",
  error: "bg-warning",
};

export function MarketScannerView() {
  const clientRef = useRef<PublicMarketDataClient | null>(null);
  const mountedRef = useRef(true);
  const [connectionState, setConnectionState] =
    useState<DerivConnectionState>("disconnected");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<DerivActiveSymbol[]>([]);
  const [query, setQuery] = useState("");
  const [entryStateFilter, setEntryStateFilter] = useState<"all" | "SIGNAL" | "MONITORING" | "COLLECTING">("all");
  const [category, setCategory] = useState<MarketCategoryId>("all");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [rotationOffset, setRotationOffset] = useState(0);
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
        if (state !== "connected") {
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
          const next = [...previous, digit].slice(-20);
          return {
            ...current,
            [snapshot.symbol]: next,
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
            if (status === "connecting") {
              return {
                ...current,
                [symbol]: {
                  symbol,
                  quote: "",
      formattedPrice: "-",
      digit: "-",
                  epoch: 0,
                  status,
                  receivedAt: Date.now(),
                },
              };
            }
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

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();

    return symbols.filter((symbol) => {
      const name = (symbol.underlying_symbol_name ?? symbol.underlying_symbol).toLowerCase();
      const code = symbol.underlying_symbol.toLowerCase();
      const matchesQuery = term.length === 0 || name.includes(term) || code.includes(term);
      const matchesCategory = category === "all" || symbol.category === category;
      const analysis = analyzeDigitBias(digitHistory[symbol.underlying_symbol] ?? []);
      const matchesEntryState = entryStateFilter === "all" || analysis.state === entryStateFilter;
      return matchesQuery && matchesCategory && matchesEntryState;
    });
  }, [category, entryStateFilter, query, symbols, digitHistory]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected") {
      return;
    }

    const handle = window.setTimeout(() => {
      client.setTickSubscriptions(
        pickLiveSymbols(rows, selectedSymbol, MAX_LIVE_TICK_STREAMS, rotationOffset),
      );
    }, 200);

    return () => window.clearTimeout(handle);
  }, [connectionState, rows, selectedSymbol, rotationOffset]);

  useEffect(() => {
    if (connectionState !== "connected" || rows.length <= MAX_LIVE_TICK_STREAMS) return;
    const timer = window.setInterval(() => {
      setRotationOffset((current) => (current + MAX_LIVE_TICK_STREAMS) % rows.length);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [connectionState, rows.length]);

  function handleWatch(symbol: string) {
    setSelectedSymbol(symbol);
  }

  const emptyMessage = emptyStateMessage({
    connectionState,
    symbolCount: symbols.length,
    visibleCount: rows.length,
    statusDetail,
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Markets
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Market Scanner
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
        {SCANNER_NOTICE}
      </p>

      {statusDetail && connectionState !== "connected" ? (
        <p className="text-sm text-muted">{statusDetail}</p>
      ) : null}

      <Card title="Filters">
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
              Search markets
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by market name or symbol"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-muted"
            />
          </label>

          <fieldset>
            <legend className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted">
              Category
            </legend>
            <div className="flex flex-wrap gap-2">
              {MARKET_CATEGORIES.map((item) => {
                const selected = category === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCategory(item.id)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      selected
                        ? "border-border bg-surface-raised text-foreground"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        <fieldset>
  <legend className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted">
    Entry state
  </legend>
  <div className="flex flex-wrap gap-2">
    {(["all", "SIGNAL", "MONITORING", "COLLECTING"] as const).map((item) => {
      const selected = entryStateFilter === item;
      return (
        <button
          key={item}
          type="button"
          onClick={() => setEntryStateFilter(item)}
          className={`rounded-md border px-3 py-1.5 text-sm ${selected ? "border-border bg-surface-raised text-foreground" : "border-border text-muted hover:text-foreground"}`}
        >
          {item === "all" ? "All" : item}
        </button>
      );
    })}
  </div>
</fieldset>
</div>
</Card>

      <Card title="Markets" badge={connectionStateLabel(connectionState)}>
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted">
                {COLUMNS.map((column) => (
                  <th key={column} className="pb-3 pr-4 font-medium last:pr-0">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="py-12 text-center">
                    <p className="text-sm font-medium text-foreground">
                      {emptyMessage.title}
                    </p>
                    <p className="mt-1 text-sm text-muted">{emptyMessage.detail}</p>
                  </td>
                </tr>
              ) : (
                rows.map((symbol) => {
                  const isSelected = selectedSymbol === symbol.underlying_symbol;
                  const tick = marketTicks[symbol.underlying_symbol];
                  const quote = quoteForRow(tick);
                  const analysis = analyzeDigits(
                    digitHistory[symbol.underlying_symbol] ?? [],
                  );

                  return (
                    <tr
                      key={symbol.underlying_symbol}
                      className={`border-b border-border last:border-0 ${
                        isSelected ? "bg-surface-raised" : ""
                      }`}
                    >
                      <td className="py-3 pr-4 text-foreground">
                        {symbol.underlying_symbol_name ?? symbol.underlying_symbol}
                      </td>
                      <td className="py-3 pr-4 font-mono text-foreground">
                        {symbol.underlying_symbol}
                      </td>
                      <td className="py-3 pr-4 font-mono text-muted">
                        {quote.price}
                      </td>
                      <td className="py-3 pr-4 font-mono text-muted">
                        {quote.digit}
                      </td>
                      <td className="py-3 pr-4 text-muted">
                        {quote.status === "LIVE" ? (
                          <span className="inline-flex items-center gap-2 text-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                            LIVE
                          </span>
                        ) : (
                          quote.status
                        )}
                      </td>
                      <td className="py-3 pr-4 text-muted"><div className="font-medium text-foreground">{analysis.strategy}</div><div className="mt-1 text-xs text-muted">{analysis.sampleSize < 10 ? "Building sample" : analysis.dominantDigit !== null ? `Dominant digit ${analysis.dominantDigit}` : "Analyzing"}</div></td>
                      <td className="py-3 pr-4"><div className="font-medium text-foreground">{analysis.entryState}</div><div className="mt-1 text-xs text-muted">{analysis.entryState === "COLLECTING" ? `Building sample | ${analysis.sampleSize}/10 ticks` : analysis.dominantDigit !== null && analysis.dominantFrequency !== null ? `${analysis.entryState === "SIGNAL" ? "Dominant" : "Watching"} digit ${analysis.dominantDigit} | ${(analysis.dominantFrequency * 100).toFixed(1)}% | ${analysis.sampleSize} ticks` : `${analysis.sampleSize} ticks`}</div></td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => handleWatch(symbol.underlying_symbol)}
                          disabled={connectionState !== "connected"}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground disabled:text-muted"
                        >
                          {isSelected ? "Watching" : "Watch"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function connectionStateLabel(state: DerivConnectionState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "error":
      return "Error";
    default:
      return "Disconnected";
  }
}

function emptyStateMessage({
  connectionState,
  symbolCount,
  visibleCount,
  statusDetail,
}: {
  connectionState: DerivConnectionState;
  symbolCount: number;
  visibleCount: number;
  statusDetail: string | null;
}): { title: string; detail: string } {
  if (connectionState === "connecting") {
    return {
      title: "Connecting to Deriv market data.",
      detail: "Active symbols will appear after the public WebSocket is connected.",
    };
  }

  if (connectionState === "error") {
    return {
      title: "Market data connection error.",
      detail: statusDetail ?? "The scanner is still available. No trades are placed from this page.",
    };
  }

  if (connectionState !== "connected") {
    return {
      title: "No live market data connected.",
      detail: statusDetail ?? "The table stays empty until the public Deriv stream is connected.",
    };
  }

  if (symbolCount === 0) {
    return {
      title: "No active symbols were returned.",
      detail: "The public feed connected, but the active-symbol list was empty.",
    };
  }

  if (visibleCount === 0) {
    return {
      title: "No markets match the current filters.",
      detail: "Clear search or choose All to see the full active-symbol list.",
    };
  }

  return {
    title: "No live market data connected.",
    detail: "The table stays empty until a public Deriv market-data stream is enabled.",
  };
}

function pickLiveSymbols(
  rows: DerivActiveSymbol[],
  selected: string | null,
  max: number,
  offset = 0,
): string[] {
  const picked: string[] = [];
  if (selected) {
    picked.push(selected);
  }
  for (const row of [...rows.slice(offset), ...rows.slice(0, offset)]) {
    if (picked.length >= max) {
      break;
    }
    if (!picked.includes(row.underlying_symbol)) {
      picked.push(row.underlying_symbol);
    }
  }
  return picked;
}

type RowAnalysis = {
  strategy: string;
  entryState: string;
  dominantDigit: number | null;
  dominantFrequency: number | null;
  sampleSize: number;
};

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

function analyzeDigits(digits: number[]): RowAnalysis {
  const valid = digits.filter(
    (digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9,
  );
  const total = valid.length;

  if (total < 10) {
    return {
      strategy: "Digit Bias",
      entryState: "COLLECTING",
      dominantDigit: null,
      dominantFrequency: null,
      sampleSize: total,
    };
  }

  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  for (const digit of valid) {
    counts[digit] += 1;
  }

  const highestCount = Math.max(...counts);
  const frequency = highestCount / total;
  const dominantDigit = counts.indexOf(highestCount);

  if (!Number.isFinite(frequency) || frequency < 0.2) {
    return {
      strategy: "Digit Bias",
      entryState: "MONITORING",
      dominantDigit,
      dominantFrequency: frequency,
      sampleSize: total,
    };
  }

  return {
    strategy: "Digit Bias",
    entryState: "SIGNAL",
    dominantDigit,
    dominantFrequency: frequency,
    sampleSize: total,
  };
}

function quoteForRow(
  tick: MarketTickSnapshot | undefined,
): { price: string; digit: string; status: string } {
  if (!tick) {
    return {
      price: "-",
      digit: "-",
      status: "Waiting",
    };
  }

  if (tick.status === "connecting") {
    return {
      price: tick.formattedPrice || "-",
      digit: tick.digit || "-",
      status: "CONNECTING",
    };
  }

  if (tick.status === "error") {
    return {
      price: tick.formattedPrice || "-",
      digit: tick.digit || "-",
      status: "ERROR",
    };
  }

  if (tick.status === "stale") {
    return {
      price: tick.formattedPrice || "-",
      digit: tick.digit || "-",
      status: "STALE",
    };
  }

  return {
    price: tick.formattedPrice || "-",
    digit: tick.digit || "-",
    status: "LIVE",
  };
}
























