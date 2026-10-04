"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { analyzeDigitBias } from "@/src/lib/strategy/digit-bias";
import { DEFAULT_RISK_CONFIG } from "@/src/lib/trading/risk";
import { closeControlledPaperTrade } from "@/src/lib/trading/controller";
import { quoteAndOpenPaperTrade } from "@/src/lib/trading/open-quoted-paper-trade";
import { getRecoveryDecision } from "@/src/lib/trading/recovery";
import {
  FREE_BOT_PRESETS,
  presetById,
  readLoadedBotId,
  writeLoadedBotId,
} from "@/src/lib/trading/bot-presets";
import {
  assignSpecialistMarkets,
  opportunityFromAnalysis,
  rankOpportunities,
  SPECIALIST_BOTS,
  type RankedOpportunity,
} from "@/src/lib/trading/master-bot";
import type { BotStrategy, PaperTrade } from "@/src/lib/trading/types";
import { createTradingSession, type TradingSession } from "@/src/lib/trading/session";
import {
  MAX_LIVE_TICK_STREAMS,
  connectionLabel,
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketTickSnapshot,
  type PublicMarketDataClient,
} from "@/src/lib/deriv";

const PAPER_PROPOSAL_CURRENCY = "USD";
const PAPER_TARGET_PROFIT = 0.1;
const LIVE_ORDERS_ENABLED = false;
const MASTER_STREAM_LIMIT = 16;

const STATUS_DOT: Record<DerivConnectionState, string> = {
  connected: "bg-accent",
  connecting: "bg-warning",
  disconnected: "bg-muted",
  error: "bg-warning",
};

export function BotMonitorView() {
  const clientRef = useRef<PublicMarketDataClient | null>(null);
  const mountedRef = useRef(true);
  const lastDigitEpochRef = useRef<Record<string, number>>({});
  const digitHistoryRef = useRef<Record<string, number[]>>({});
  const proposalInFlightRef = useRef<Record<string, boolean>>({});
  const tradingSessionRef = useRef<TradingSession>(createTradingSession());
  const openPaperTradeRef = useRef<PaperTrade | null>(null);
  const paperRunningRef = useRef(false);
  const assignedRef = useRef<Record<BotStrategy, RankedOpportunity | null>>({
    UNDER_7: null,
    OVER_2: null,
    OVER_3: null,
    UNDER_8: null,
    EVEN_ODD: null,
  });
  const excludeSymbolsRef = useRef<string[]>([]);
  const allowedStrategiesRef = useRef<Set<BotStrategy>>(new Set());
  const [loadedBotId, setLoadedBotId] = useState("autoswitcher");

  const [connectionState, setConnectionState] =
    useState<DerivConnectionState>("disconnected");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<DerivActiveSymbol[]>([]);
  const [marketTicks, setMarketTicks] = useState<Record<string, MarketTickSnapshot>>(
    {},
  );
  const [digitHistory, setDigitHistory] = useState<Record<string, number[]>>({});
  const [paperRunning, setPaperRunning] = useState(false);
  const [tradingSession, setTradingSession] = useState<TradingSession>(
    createTradingSession,
  );
  const [openPaperTrade, setOpenPaperTrade] = useState<PaperTrade | null>(null);
  const [lastClosed, setLastClosed] = useState<PaperTrade | null>(null);
  const [excludeSymbols, setExcludeSymbols] = useState<string[]>([]);

  useEffect(() => {
    digitHistoryRef.current = digitHistory;
  }, [digitHistory]);

  useEffect(() => {
    tradingSessionRef.current = tradingSession;
  }, [tradingSession]);

  useEffect(() => {
    openPaperTradeRef.current = openPaperTrade;
  }, [openPaperTrade]);

  useEffect(() => {
    paperRunningRef.current = paperRunning;
  }, [paperRunning]);

  useEffect(() => {
    excludeSymbolsRef.current = excludeSymbols;
  }, [excludeSymbols]);

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

        let nextHistory: number[] = [];
        setDigitHistory((current) => {
          const previous = current[snapshot.symbol] ?? [];
          const next = [...previous, digit].slice(-20);
          digitHistoryRef.current[snapshot.symbol] = next;
          nextHistory = next;
          return {
            ...current,
            [snapshot.symbol]: next,
          };
        });

        const openTrade = openPaperTradeRef.current;
        if (openTrade && openTrade.symbol === snapshot.symbol) {
          const result = closeControlledPaperTrade(
            tradingSessionRef.current,
            openTrade,
            digit,
          );
          tradingSessionRef.current = result.session;
          openPaperTradeRef.current = null;
          setTradingSession(result.session);
          setOpenPaperTrade(null);
          setLastClosed(result.trade);
          if (result.trade.status === "LOST") {
            setExcludeSymbols((current) =>
              uniqueTail([...current, result.trade.symbol], 6),
            );
          } else if (result.trade.status === "WON") {
            setExcludeSymbols([]);
          }
          return;
        }

        if (
          !LIVE_ORDERS_ENABLED &&
          paperRunningRef.current &&
          !openPaperTradeRef.current
        ) {
          openAssignedPaperTrade({
            symbol: snapshot.symbol,
            history: nextHistory,
            client: clientRef.current,
            assigned: assignedRef.current,
            excluded: excludeSymbolsRef.current,
            session: tradingSessionRef.current,
            inFlight: proposalInFlightRef.current,
            allowedStrategies: allowedStrategiesRef.current,
            mounted: () => mountedRef.current,
            hasOpenTrade: () => Boolean(openPaperTradeRef.current),
            onOpened: (trade) => {
              openPaperTradeRef.current = trade;
              setOpenPaperTrade(trade);
            },
            onQuoteError: () => {
              setStatusDetail(
                "Paper proposal quote failed. No paper trade was opened.",
              );
            },
          });
        }
      },
    });
    clientRef.current = session.client;
    return () => {
      mountedRef.current = false;
      clientRef.current = null;
      session.release();
    };
  }, []);

  const watched = useMemo(
    () => symbols.slice(0, MASTER_STREAM_LIMIT).map((item) => item.underlying_symbol),
    [symbols],
  );

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected") {
      return;
    }
    const handle = window.setTimeout(() => {
      client.setTickSubscriptions(watched.slice(0, MAX_LIVE_TICK_STREAMS));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [connectionState, watched]);

  const ranked = useMemo(() => {
    const items: RankedOpportunity[] = [];
    for (const code of watched) {
      const meta = symbols.find((item) => item.underlying_symbol === code);
      const opportunity = opportunityFromAnalysis(
        code,
        meta?.underlying_symbol_name ?? code,
        analyzeDigitBias(digitHistory[code] ?? []),
      );
      if (opportunity) {
        items.push(opportunity);
      }
    }
    return rankOpportunities(items);
  }, [digitHistory, symbols, watched]);

  const assigned = useMemo(
    () => assignSpecialistMarkets(ranked, new Set(excludeSymbols)),
    [excludeSymbols, ranked],
  );

  useEffect(() => {
    setLoadedBotId(readLoadedBotId());
  }, []);

  const loadedPreset = presetById(loadedBotId);
  assignedRef.current = assigned;
  allowedStrategiesRef.current = new Set(loadedPreset.strategies);
  const recovery = getRecoveryDecision(tradingSession);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Paper bots
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Bot Monitor
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
            <span
              className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[connectionState]}`}
              aria-hidden
            />
            <span className="font-medium text-foreground">
              {connectionLabel(connectionState)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPaperRunning((current) => !current)}
            disabled={connectionState !== "connected"}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground disabled:text-muted"
          >
            {paperRunning ? "Pause paper bots" : "Start paper bots"}
          </button>
        </div>
      </div>

      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground">
        Load a free paper bot, then start it. Autoswitcher is the Master.
        Specialists cover Under, Over, and Even/Odd. Live buy/sell stays off.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FREE_BOT_PRESETS.map((bot) => {
          const loaded = bot.id === loadedBotId;
          return (
            <article
              key={bot.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted">
                  {bot.family}
                </p>
                {loaded ? (
                  <span className="text-[10px] uppercase tracking-wide text-accent">
                    Loaded
                  </span>
                ) : null}
              </div>
              <h3 className="text-sm font-semibold text-foreground">{bot.name}</h3>
              <p className="text-sm text-muted">{bot.summary}</p>
              <button
                type="button"
                onClick={() => {
                  writeLoadedBotId(bot.id);
                  setLoadedBotId(bot.id);
                }}
                className="mt-auto rounded-md border border-border px-3 py-1.5 text-sm"
              >
                {loaded ? "Loaded" : "Load bot"}
              </button>
            </article>
          );
        })}
      </div>

      {statusDetail && connectionState !== "connected" ? (
        <p className="text-sm text-muted">{statusDetail}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Paper P/L" value={tradingSession.profitLoss.toFixed(2)} />
        <Stat
          label="Wins / Losses"
          value={`${tradingSession.wins} / ${tradingSession.losses}`}
        />
        <Stat label="Mode" value={recovery.recoveryMode ? "Recovery" : "Normal"} />
        <Stat
          label="Open paper trade"
          value={openPaperTrade ? openPaperTrade.strategy.replaceAll("_", " ") : "None"}
        />
      </div>

      <Card title="Master bot" badge={connectionState === "connected" ? "Scanning" : "Offline"}>
        <p className="mb-4 text-sm text-muted">
          {recovery.reason}. Markets recently lost on paper are skipped until a win.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted">
                <th className="pb-3 pr-4 font-medium">Market</th>
                <th className="pb-3 pr-4 font-medium">Fit</th>
                <th className="pb-3 pr-4 font-medium">Digit</th>
                <th className="pb-3 pr-4 font-medium">Confidence</th>
                <th className="pb-3 font-medium">Ready</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-muted">
                    Waiting for synthetic tick samples.
                  </td>
                </tr>
              ) : (
                ranked.slice(0, 10).map((row) => (
                  <tr key={`${row.symbol}-${row.strategy}`} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 text-foreground">{row.marketName}</td>
                    <td className="py-3 pr-4 text-foreground">
                      {labelForStrategy(row.strategy)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-muted">{row.dominantDigit}</td>
                    <td className="py-3 pr-4 font-mono text-muted">
                      {(row.confidence * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 text-muted">{row.ready ? "SIGNAL" : "Watching"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {SPECIALIST_BOTS.map((bot) => {
          const slot = assigned[bot.id];
          const tick = slot ? marketTicks[slot.symbol] : undefined;
          return (
            <Card
              key={bot.id}
              title={`${bot.label} bot`}
              badge={slot?.ready ? "Armed" : slot ? "Watching" : "Idle"}
            >
              <dl className="grid gap-3 sm:grid-cols-2">
                <Info label="Assigned market" value={slot?.marketName ?? "Waiting for fit"} />
                <Info label="Tick" value={tick?.formattedPrice ?? "—"} />
                <Info label="Digit" value={tick?.digit ?? "—"} />
                <Info
                  label="Confidence"
                  value={
                    slot ? `${(slot.confidence * 100).toFixed(1)}%` : "—"
                  }
                />
              </dl>
            </Card>
          );
        })}
      </div>

      {lastClosed ? (
        <p className="text-sm text-muted">
          Last paper result: {lastClosed.status} on {lastClosed.symbol} (
          {lastClosed.profitLoss.toFixed(2)})
        </p>
      ) : null}

      {!paperRunning ? (
        <p className="text-sm text-muted">
          Paper bots are paused. Start them to open quoted paper trades only.
        </p>
      ) : null}
    </div>
  );
}

function openAssignedPaperTrade(params: {
  symbol: string;
  history: number[];
  client: PublicMarketDataClient | null;
  assigned: Record<BotStrategy, RankedOpportunity | null>;
  excluded: string[];
  session: TradingSession;
  inFlight: Record<string, boolean>;
  allowedStrategies: ReadonlySet<BotStrategy>;
  mounted: () => boolean;
  hasOpenTrade: () => boolean;
  onOpened: (trade: PaperTrade) => void;
  onQuoteError: () => void;
}) {
  const { client, symbol, history } = params;
  if (!client) {
    return;
  }
  const analysis = analyzeDigitBias(history);
  const opportunity = opportunityFromAnalysis(symbol, symbol, analysis);
  if (!opportunity?.ready) {
    return;
  }
  if (!params.allowedStrategies.has(opportunity.strategy)) {
    return;
  }
  const slot = params.assigned[opportunity.strategy];
  if (!slot || slot.symbol !== symbol) {
    return;
  }
  if (params.excluded.includes(symbol)) {
    return;
  }

  void quoteAndOpenPaperTrade({
    client,
    symbol,
    analysis,
    session: params.session,
    currency: PAPER_PROPOSAL_CURRENCY,
    targetProfit: PAPER_TARGET_PROFIT,
    riskConfig: DEFAULT_RISK_CONFIG,
    inFlight: params.inFlight,
  })
    .then((trade) => {
      if (!trade || !params.mounted() || params.hasOpenTrade()) {
        return;
      }
      params.onOpened(trade);
    })
    .catch(() => {
      if (params.mounted()) {
        params.onQuoteError();
      }
    });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-border bg-surface px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function labelForStrategy(strategy: BotStrategy): string {
  return SPECIALIST_BOTS.find((item) => item.id === strategy)?.label ?? strategy;
}

function uniqueTail(values: string[], max: number): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
  }
  return unique.slice(-max);
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
