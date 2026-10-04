"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_RISK_CONFIG, canPlaceTrade } from "@/src/lib/trading/risk";
import { closeControlledPaperTrade } from "@/src/lib/trading/controller";
import { openArmedPaperTrade } from "@/src/lib/trading/armed-paper-trade";
import { getRecoveryDecision } from "@/src/lib/trading/recovery";
import {
  presetById,
  readLoadedBotId,
  writeLoadedBotId,
} from "@/src/lib/trading/bot-presets";
import { BotGallery } from "@/components/bots/BotGallery";
import { FREE_BOT_GALLERY } from "@/components/bots/free-bots-catalog";
import { ActiveBotPanel } from "@/components/bots/ActiveBotPanel";
import { MasterControlPanel } from "@/components/bots/MasterControlPanel";
import {
  SPECIALIST_BOTS,
  type RankedOpportunity,
} from "@/src/lib/trading/master-bot";
import { decideEntry, type EntryDecision } from "@/src/lib/trading/entry-signal";
import { routeMarkets } from "@/src/lib/trading/market-router";
import {
  emptyPerformanceBook,
  recordPaperOutcome,
  type PaperPerformanceBook,
} from "@/src/lib/trading/performance-memory";
import { fitForStrategy } from "@/src/lib/trading/specialist-edge";
import {
  gateForMasterRole,
  paperExecutionPermitted,
  resolveActiveMasterRole,
  type ActiveMasterRole,
} from "@/src/lib/trading/master-role";
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
const PERFORMANCE_STORAGE_KEY = "deriv.intelligence.paper-performance";

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
  const masterRoleRef = useRef<ActiveMasterRole>("router");
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
  const [performanceBook, setPerformanceBook] = useState<PaperPerformanceBook>(
    readPerformanceBook,
  );
  const performanceRef = useRef<PaperPerformanceBook>(performanceBook);
  const entryConfidenceRef = useRef(0);

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
    performanceRef.current = performanceBook;
    if (typeof sessionStorage === "undefined") {
      return;
    }
    sessionStorage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(performanceBook));
  }, [performanceBook]);

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
          if (result.trade.status === "WON" || result.trade.status === "LOST") {
            const nextBook = recordPaperOutcome(performanceRef.current, {
              market: result.trade.symbol,
              strategy: result.trade.strategy,
              contractType: result.trade.contractType,
              barrier: result.trade.barrier,
              won: result.trade.status === "WON",
              profitLoss: result.trade.profitLoss,
              confidence: entryConfidenceRef.current,
            });
            performanceRef.current = nextBook;
            setPerformanceBook(nextBook);
          }
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
            masterRole: masterRoleRef.current,
            mounted: () => mountedRef.current,
            hasOpenTrade: () => Boolean(openPaperTradeRef.current),
            onOpened: (trade) => {
              openPaperTradeRef.current = trade;
              setOpenPaperTrade(trade);
            },
            onArmed: (confidence) => {
              entryConfidenceRef.current = confidence;
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
      client.setTickSubscriptions(
        watched.slice(0, MAX_LIVE_TICK_STREAMS),
        "bot-monitor",
        1,
      );
    }, 200);
    return () => {
      window.clearTimeout(handle);
      client.releaseTickSubscriptions("bot-monitor");
    };
  }, [connectionState, watched]);

  const routed = useMemo(
    () =>
      routeMarkets({
        markets: watched.map((code) => ({
          symbol: code,
          marketName:
            symbols.find((item) => item.underlying_symbol === code)?.underlying_symbol_name ??
            code,
          digits: digitHistory[code] ?? [],
        })),
        performance: performanceBook,
        excludeSymbols: new Set(excludeSymbols),
      }),
    [digitHistory, excludeSymbols, performanceBook, symbols, watched],
  );
  const ranked = routed.ranked;
  const assigned = routed.assigned;

  useEffect(() => {
    setLoadedBotId(readLoadedBotId());
  }, []);

  const loadedCard = FREE_BOT_GALLERY.find((item) => item.galleryId === loadedBotId);
  const loadedPreset = presetById(loadedCard?.presetId ?? loadedBotId);
  const allowedStrategyList = loadedCard?.specialist
    ? [loadedCard.specialist]
    : loadedPreset.strategies;
  const masterRole = resolveActiveMasterRole(loadedPreset, loadedCard?.specialist);
  assignedRef.current = assigned;
  allowedStrategiesRef.current = new Set(allowedStrategyList);
  masterRoleRef.current = masterRole;
  const recovery = getRecoveryDecision(tradingSession);
  const risk = canPlaceTrade(tradingSession);
  const entryByStrategy = useMemo(() => {
    const decisions = {} as Record<BotStrategy, EntryDecision>;
    for (const bot of SPECIALIST_BOTS) {
      const slot = assigned[bot.id];
      const digits = slot ? (digitHistory[slot.symbol] ?? []) : [];
      decisions[bot.id] = gateForMasterRole(
        masterRole,
        decideEntry({
          enabled: allowedStrategyList.includes(bot.id),
          open: openPaperTrade?.strategy === bot.id,
          riskAllowed: risk.allowed && recovery.allowed,
          riskReason: risk.allowed ? recovery.reason : risk.reason,
          minimumConfidence: recovery.minimumConfidence,
          fit: slot ? fitForStrategy(digits, bot.id) : null,
        }),
      );
    }
    return decisions;
  }, [
    allowedStrategyList,
    assigned,
    masterRole,
    digitHistory,
    openPaperTrade,
    recovery.allowed,
    recovery.minimumConfidence,
    recovery.reason,
    risk.allowed,
    risk.reason,
  ]);
  const cooldownActive =
    tradingSession.consecutiveLosses > 0 &&
    tradingSession.lastLossAt !== null &&
    Date.now() - tradingSession.lastLossAt < DEFAULT_RISK_CONFIG.cooldownAfterLossMs;
  const marketDataLabel =
    connectionState === "connected"
      ? "Live"
      : connectionState === "connecting"
        ? "Connecting"
        : connectionState === "error"
          ? "Error"
          : "Disconnected";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 pb-8">
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
              Deriv Intelligence
            </p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              Free Bots
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
              Choose a specialist bot, load it, and let the Master coordinate the
              market.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPaperRunning((current) => !current)}
            disabled={connectionState !== "connected"}
            className="rounded-xl border border-warning/40 bg-warning/15 px-4 py-2.5 text-sm font-medium text-foreground disabled:text-muted"
          >
            {paperRunning ? "Pause paper bots" : "Start paper bots"}
          </button>
        </div>

        <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warning">
            Paper trading
          </p>
          <p className="mt-1 text-sm leading-6 text-foreground">
            Bots use live Deriv market data and paper execution. Real-money order
            execution is disabled.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <StatusChip
            live={connectionState === "connected"}
            label={`Market Data: ${marketDataLabel}`}
          />
          <StatusChip paper label="Trading Mode: PAPER" />
          <StatusChip
            live={paperRunning && connectionState === "connected"}
            label={`Master: ${
              paperRunning
                ? masterRole === "router"
                  ? "Routing"
                  : masterRole === "entry"
                    ? "Gating"
                    : "Specialist"
                : "Paused"
            }`}
          />
          <StatusChip label={`Loaded Bots: ${allowedStrategyList.length}`} />
        </div>
      </header>

      <BotGallery
        loadedPresetId={loadedBotId}
        cardState={(item) => {
          const slot = item.specialist ? assigned[item.specialist] : null;
          const entry = item.specialist ? entryByStrategy[item.specialist] : null;
          const loaded = loadedBotId === item.galleryId;
          return {
            loaded,
            status: entry?.phase ?? (loaded ? "LOADED" : "IDLE"),
            assignedMarket: loaded ? slot?.marketName : undefined,
            confidence:
              loaded && slot ? `${(slot.confidence * 100).toFixed(1)}%` : undefined,
            ready: entry?.phase === "ARMED",
            reason: loaded ? entry?.reason ?? slot?.reason : undefined,
          };
        }}
        onLoad={(galleryId) => {
          writeLoadedBotId(galleryId);
          setLoadedBotId(galleryId);
        }}
      />

      {statusDetail && connectionState !== "connected" ? (
        <p className="text-sm text-muted">{statusDetail}</p>
      ) : null}

      <MasterControlPanel
        roleTitle={
          masterRole === "router"
            ? "Market Router"
            : masterRole === "entry"
              ? "Entry Signal Hunter"
              : loadedCard?.name ?? "Specialist"
        }
        activityLabel={
          masterRole === "router"
            ? "Routing"
            : masterRole === "entry"
              ? "Gating"
              : "Specialist"
        }
        connectionLabel={connectionLabel(connectionState)}
        paperRunning={paperRunning}
        recoveryReason={recovery.reason}
        recoveryMode={recovery.recoveryMode}
        marketsScanned={watched.length}
        ranked={ranked}
        assigned={assigned}
        profitLoss={tradingSession.profitLoss}
        wins={tradingSession.wins}
        losses={tradingSession.losses}
        openPaperTrade={openPaperTrade}
      />

      <ActiveBotPanel
        assigned={assigned}
        marketTicks={marketTicks}
        allowedStrategies={new Set(allowedStrategyList)}
        openPaperTrade={openPaperTrade}
        cooldown={cooldownActive}
        entries={entryByStrategy}
      />

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

function StatusChip({
  label,
  live = false,
  paper = false,
}: {
  label: string;
  live?: boolean;
  paper?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-[#151a22] px-3 py-1.5 text-foreground">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          paper ? "bg-warning" : live ? "bg-accent" : "bg-muted"
        }`}
        aria-hidden
      />
      {label}
    </span>
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
  masterRole: ActiveMasterRole;
  mounted: () => boolean;
  hasOpenTrade: () => boolean;
  onOpened: (trade: PaperTrade) => void;
  onArmed: (confidence: number) => void;
  onQuoteError: () => void;
}) {
  const { client, symbol, history } = params;
  if (!client) {
    return;
  }
  const slot = Object.values(params.assigned).find(
    (item) => item?.symbol === symbol && params.allowedStrategies.has(item.strategy),
  );
  if (!slot || params.excluded.includes(symbol)) {
    return;
  }
  const fit = fitForStrategy(history, slot.strategy);
  const risk = canPlaceTrade(params.session);
  const recovery = getRecoveryDecision(params.session);
  const entry = decideEntry({
    enabled: true,
    open: params.hasOpenTrade(),
    riskAllowed: risk.allowed && recovery.allowed,
    riskReason: risk.allowed ? recovery.reason : risk.reason,
    minimumConfidence: recovery.minimumConfidence,
    fit,
  });
  if (!fit || !paperExecutionPermitted(params.masterRole, entry.phase)) {
    return;
  }

  void openArmedPaperTrade({
    client,
    symbol,
    fit,
    session: params.session,
    currency: PAPER_PROPOSAL_CURRENCY,
    targetProfit: PAPER_TARGET_PROFIT,
    riskConfig: DEFAULT_RISK_CONFIG,
    inFlight: params.inFlight,
  }).then((trade) => {
    if (!trade) {
      return null;
    }
    params.onArmed(fit.probability);
    return trade;
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

function readPerformanceBook(): PaperPerformanceBook {
  if (typeof sessionStorage === "undefined") {
    return emptyPerformanceBook();
  }
  try {
    const raw = sessionStorage.getItem(PERFORMANCE_STORAGE_KEY);
    if (!raw) {
      return emptyPerformanceBook();
    }
    const parsed = JSON.parse(raw) as PaperPerformanceBook;
    if (!parsed || !Array.isArray(parsed.records)) {
      return emptyPerformanceBook();
    }
    return { records: parsed.records.slice(0, 100) };
  } catch {
    return emptyPerformanceBook();
  }
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
