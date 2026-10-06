"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BotGallery } from "@/components/bots/BotGallery";
import { FREE_BOT_GALLERY } from "@/components/bots/free-bots-catalog";
import { ActiveBotPanel } from "@/components/bots/ActiveBotPanel";
import { MasterControlPanel } from "@/components/bots/MasterControlPanel";
import { MarketRouterPanel } from "@/components/bots/MarketRouterPanel";
import { RuntimeControlBar } from "@/components/bots/RuntimeControlBar";
import {
  connectionLabel,
  retainPublicMarketData,
  type DerivActiveSymbol,
  type DerivConnectionState,
  type MarketTickSnapshot,
  type PublicMarketDataClient,
} from "@/src/lib/deriv";
import { openArmedPaperTrade } from "@/src/lib/trading/armed-paper-trade";
import {
  presetById,
  readLoadedBotId,
  writeLoadedBotId,
} from "@/src/lib/trading/bot-presets";
import { emptyDigitSamples, recordDigitSample, type DigitSampleBook } from "@/src/lib/trading/digit-samples";
import { decideEntry, type EntryDecision } from "@/src/lib/trading/entry-signal";
import { LIVE_ORDERS_ENABLED } from "@/src/lib/trading/live-orders";
import {
  discoverEligibleMarkets,
  parseDigitContracts,
  unknownDigitContracts,
  type EligibleMarket,
  type ParsedDigitContracts,
} from "@/src/lib/trading/market-universe";
import { routeMarkets, type RouterOpportunity } from "@/src/lib/trading/market-router";
import { SPECIALIST_BOTS } from "@/src/lib/trading/master-bot";
import {
  commitOpenPosition,
  emptyPaperBook,
  settleSymbolPosition,
  type PaperPositionBook,
  type TrackedPaperPosition,
} from "@/src/lib/trading/paper-book";
import {
  emptyPerformanceBook,
  recordPaperOutcome,
  type PaperPerformanceBook,
} from "@/src/lib/trading/performance-memory";
import { simulatedResultLabel } from "@/src/lib/trading/paper-engine";
import { canPlaceTrade, DEFAULT_RISK_CONFIG } from "@/src/lib/trading/risk";
import { getRecoveryDecision } from "@/src/lib/trading/recovery";
import {
  applyPaperSlotLimits,
  evaluateAssignmentEntries,
  mayOpenPaperTrade,
  routerTableRows,
  type RouterTableRow,
} from "@/src/lib/trading/run-cycle";
import {
  blockArmedEntries,
  createRuntimeState,
  dispatchRuntime,
  entriesAllowed,
  MIN_COOLDOWN_SECONDS,
  noteRuntime,
  parseCooldownSeconds,
  recordSessionTrade,
  selectCooldownDuration,
  type RuntimeCommand,
  type RuntimeState,
} from "@/src/lib/trading/runtime-session";
import { createTradingSession, type TradingSession } from "@/src/lib/trading/session";
import { recordScanNotes, summarizeScan } from "@/src/lib/trading/scan-journal";
import { fitForStrategy, MIN_DIGIT_SAMPLE } from "@/src/lib/trading/specialist-edge";
import {
  openLivePaperRecord,
  readLivePaperBook,
  settleLivePaperRecord,
  writeLivePaperBook,
  type LivePaperBook,
} from "@/src/lib/research/forward";
import { definitionForBotStrategy } from "@/src/lib/research/registry";
import { resolveActiveMasterRole } from "@/src/lib/trading/master-role";
import type { BotStrategy, PaperTrade } from "@/src/lib/trading/types";

const PAPER_PROPOSAL_CURRENCY = "USD";
const PAPER_TARGET_PROFIT = 0.1;
const PERFORMANCE_STORAGE_KEY = "deriv.intelligence.paper-performance";
const DISPLAY_FLUSH_MS = 400;
const PROPOSAL_BACKOFF_MS = 5_000;
const CONTRACT_RETRY_MS = 30_000;
const CONTRACT_PROBE_CONCURRENCY = 4;

type RouterModel = {
  discovered: number;
  subscribed: number;
  sufficient: number;
  qualified: number;
  assignmentCount: number;
  rows: RouterTableRow[];
  slots: Set<string>;
  ranked: RouterOpportunity[];
  assignments: Record<string, RouterOpportunity>;
  assigned: Record<BotStrategy, RouterOpportunity | null>;
  entries: Record<string, EntryDecision>;
};

const EMPTY_ASSIGNED: Record<BotStrategy, RouterOpportunity | null> = {
  UNDER_7: null,
  UNDER_8: null,
  OVER_2: null,
  OVER_3: null,
  EVEN_ODD: null,
};

function emptyRouterModel(): RouterModel {
  return {
    discovered: 0,
    subscribed: 0,
    sufficient: 0,
    qualified: 0,
    assignmentCount: 0,
    rows: [],
    slots: new Set<string>(),
    ranked: [],
    assignments: {},
    assigned: EMPTY_ASSIGNED,
    entries: {},
  };
}

export function BotMonitorView() {
  const clientRef = useRef<PublicMarketDataClient | null>(null);
  const mountedRef = useRef(true);
  const samplesRef = useRef<DigitSampleBook>(emptyDigitSamples());
  const paperRef = useRef<PaperPositionBook>(emptyPaperBook());
  const proposalInFlightRef = useRef<Record<string, boolean>>({});
  const proposalBackoffRef = useRef<Record<string, number>>({});
  const tradingSessionRef = useRef<TradingSession>(createTradingSession());
  const entriesAllowedRef = useRef(false);
  const runtimeRef = useRef<RuntimeState>(createRuntimeState());
  const contractsRef = useRef<Record<string, ParsedDigitContracts>>({});
  const contractRetryRef = useRef<Record<string, number>>({});
  const symbolsRef = useRef<DerivActiveSymbol[]>([]);
  const connectionRef = useRef<DerivConnectionState>("disconnected");
  const ticksRef = useRef<Record<string, MarketTickSnapshot>>({});
  const modelRef = useRef<RouterModel>(emptyRouterModel());
  const sampleReadyRef = useRef<Set<string>>(new Set());
  const discoveryCountRef = useRef(-1);
  const publishTimerRef = useRef<number | null>(null);
  const performanceRef = useRef<PaperPerformanceBook>(readPerformanceBook());
  const forwardRef = useRef<LivePaperBook>(readLivePaperBook());
  const handleDigitRef = useRef<(snapshot: MarketTickSnapshot) => void>(() => {});
  const publishRef = useRef<(immediate?: boolean) => void>(() => {});

  const [loadedBotId, setLoadedBotId] = useState("autoswitcher");
  const [connectionState, setConnectionState] = useState<DerivConnectionState>("disconnected");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<DerivActiveSymbol[]>([]);
  const [marketTicks, setMarketTicks] = useState<Record<string, MarketTickSnapshot>>({});
  const [runtime, setRuntime] = useState<RuntimeState>(createRuntimeState);
  const [cooldownInput, setCooldownInput] = useState(String(MIN_COOLDOWN_SECONDS));
  const [cooldownError, setCooldownError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [tradingSession, setTradingSession] = useState<TradingSession>(createTradingSession);
  const [openPositions, setOpenPositions] = useState<PaperTrade[]>([]);
  const [lastClosed, setLastClosed] = useState<PaperTrade | null>(null);
  const [settledTrades, setSettledTrades] = useState<PaperTrade[]>([]);
  const [performanceBook, setPerformanceBook] = useState<PaperPerformanceBook>(
    performanceRef.current,
  );
  const [forwardBook, setForwardBook] = useState<LivePaperBook>(forwardRef.current);
  const [routerModel, setRouterModel] = useState<RouterModel>(emptyRouterModel);

  function commitRuntime(next: RuntimeState) {
    runtimeRef.current = next;
    entriesAllowedRef.current = entriesAllowed(next.phase);
    return next;
  }

  function rebuildModel(): RouterModel {
    const markets = discoverEligibleMarkets(symbolsRef.current);
    const phase = runtimeRef.current.phase;
    const active = phase !== "STOPPED";
    const routed = routeMarkets({
      markets: markets.map((market) => ({
        symbol: market.symbol,
        marketName: market.displayName,
        digits: samplesRef.current.digits[market.symbol] ?? [],
        contracts: contractsRef.current[market.symbol] ?? unknownDigitContracts(),
      })),
      performance: performanceRef.current,
    });
    const openSymbols = new Set(Object.keys(paperRef.current.open));
    const openCount = openSymbols.size;
    const risk = canPlaceTrade(
      tradingSessionRef.current,
      DEFAULT_RISK_CONFIG,
      Date.now(),
      openCount,
    );
    const recovery = getRecoveryDecision(tradingSessionRef.current);
    const entries = active
      ? evaluateAssignmentEntries({
          assignments: routed.assignments,
          digits: samplesRef.current.digits,
          openSymbols,
          phase,
          riskAllowed: risk.allowed && recovery.allowed,
          riskReason: risk.allowed ? recovery.reason : risk.reason,
          minimumConfidence: recovery.minimumConfidence,
        })
      : {};
    const limited = applyPaperSlotLimits(
      routerTableRows({
        assignments: routed.assignments,
        entries,
        openSymbols,
      }),
      openSymbols,
      DEFAULT_RISK_CONFIG.maxOpenPaperPositions,
    );
    const model: RouterModel = {
      discovered: markets.length,
      subscribed: active && connectionRef.current === "connected" ? markets.length : 0,
      sufficient: markets.filter(
        (market) => (samplesRef.current.digits[market.symbol]?.length ?? 0) >= MIN_DIGIT_SAMPLE,
      ).length,
      qualified: routed.ranked.length,
      assignmentCount: Object.keys(routed.assignments).length,
      rows: limited.rows,
      slots: limited.slots,
      ranked: routed.ranked,
      assignments: routed.assignments,
      assigned: routed.assigned,
      entries,
    };
    modelRef.current = model;
    if (active) {
      journalRouter(model);
    }
    return model;
  }

  function journalRouter(model: RouterModel) {
    let state = runtimeRef.current;
    state = recordScanNotes(
      state,
      summarizeScan({
        discovered: model.discovered,
        rows: model.rows,
      }),
      Date.now(),
    );
    if (state !== runtimeRef.current) {
      commitRuntime(state);
    }
  }

  function flushDisplay() {
    if (!mountedRef.current) {
      return;
    }
    setMarketTicks({ ...ticksRef.current });
    setRouterModel(modelRef.current);
    setOpenPositions(Object.values(paperRef.current.open));
    setTradingSession(tradingSessionRef.current);
    setRuntime(runtimeRef.current);
    setPerformanceBook(performanceRef.current);
  }

  function publish(immediate = false) {
    rebuildModel();
    if (!mountedRef.current) {
      return;
    }
    if (immediate) {
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
      }
      flushDisplay();
      return;
    }
    if (publishTimerRef.current !== null) {
      return;
    }
    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null;
      flushDisplay();
    }, DISPLAY_FLUSH_MS);
  }

  function handleDigit(snapshot: MarketTickSnapshot) {
    if (!mountedRef.current) {
      return;
    }
    ticksRef.current = { ...ticksRef.current, [snapshot.symbol]: snapshot };
    if (snapshot.status !== "live") {
      publish(false);
      return;
    }
    const digit = parseValidDigit(snapshot.digit);
    if (digit === null) {
      publish(false);
      return;
    }

    const recorded = recordDigitSample(
      samplesRef.current,
      snapshot.symbol,
      snapshot.epoch,
      digit,
    );
    if (!recorded.accepted) {
      return;
    }
    samplesRef.current = recorded.book;
    if (
      recorded.history.length >= MIN_DIGIT_SAMPLE &&
      !sampleReadyRef.current.has(snapshot.symbol) &&
      runtimeRef.current.phase !== "STOPPED"
    ) {
      sampleReadyRef.current.add(snapshot.symbol);
      commitRuntime(
        noteRuntime(
          runtimeRef.current,
          "SAMPLE_READY",
          `${snapshot.symbol} sample is ready (${recorded.history.length}).`,
          Date.now(),
        ),
      );
    }

    const position = paperRef.current.open[snapshot.symbol];
    if (position) {
      const ownsSession = position.runtimeSessionId === runtimeRef.current.session?.id;
      const result = settleSymbolPosition(
        paperRef.current,
        ownsSession ? tradingSessionRef.current : createTradingSession(),
        snapshot.symbol,
        digit,
        snapshot.epoch,
      );
      if (result.settled && result.trade) {
        paperRef.current = result.book;
        if (ownsSession) {
          tradingSessionRef.current = result.session;
        }
        const nextBook = recordPaperOutcome(performanceRef.current, {
          market: result.trade.symbol,
          strategy: result.trade.strategy,
          contractType: result.trade.contractType,
          barrier: result.trade.barrier,
          won: result.trade.status === "WON",
          profitLoss: result.trade.profitLoss,
          confidence: position.confidence,
        });
        performanceRef.current = nextBook;
        setPerformanceBook(nextBook);
        const nextForward = settleLivePaperRecord(forwardRef.current, result.trade.id, {
          won: result.trade.status === "WON",
          profitLoss: result.trade.profitLoss,
          exitDigit: result.trade.exitDigit ?? digit,
        });
        forwardRef.current = nextForward;
        setForwardBook(nextForward);
        if (runtimeRef.current.session) {
          commitRuntime(
            recordSessionTrade(runtimeRef.current, {
              tradeId: result.trade.id,
              sessionId: position.runtimeSessionId || runtimeRef.current.session.id,
              symbol: result.trade.symbol,
              strategy: result.trade.strategy,
              won: result.trade.status === "WON",
              profitLoss: result.trade.profitLoss,
              settledAt: result.trade.closedAt ?? Date.now(),
            }),
          );
        }
        setLastClosed(result.trade);
        setSettledTrades((current) => [result.trade!, ...current].slice(0, 12));
        publish(true);
      } else {
        publish(false);
      }
      return;
    }

    maybeOpen(snapshot.symbol, snapshot.epoch, digit, recorded.history);
    publish(false);
  }

  function maybeOpen(symbol: string, epoch: number, digit: number, history: number[]) {
    if (LIVE_ORDERS_ENABLED || !entriesAllowedRef.current) {
      return;
    }
    if ((proposalBackoffRef.current[symbol] ?? 0) > Date.now()) {
      return;
    }
    if (proposalInFlightRef.current[symbol] || paperRef.current.open[symbol]) {
      return;
    }
    const client = clientRef.current;
    if (!client || epoch <= 0) {
      return;
    }
    const model = rebuildModel();
    const assignment = model.assignments[symbol];
    const entry = model.entries[symbol];
    if (!assignment || !entry) {
      return;
    }
    if (!model.slots.has(symbol)) {
      return;
    }
    if (
      !mayOpenPaperTrade({
        role: "specialist",
        entryPhase: entry.phase,
        liveOrdersEnabled: LIVE_ORDERS_ENABLED,
        runtimePhase: runtimeRef.current.phase,
      })
    ) {
      return;
    }
    const fit = fitForStrategy(history, assignment.strategy);
    if (!fit?.qualified) {
      return;
    }
    const sessionId = runtimeRef.current.session?.id ?? "";
    void openArmedPaperTrade({
      client,
      symbol,
      fit,
      session: tradingSessionRef.current,
      currency: PAPER_PROPOSAL_CURRENCY,
      targetProfit: PAPER_TARGET_PROFIT,
      riskConfig: DEFAULT_RISK_CONFIG,
      inFlight: proposalInFlightRef.current,
      entryDigit: digit,
      accept: (trade) => {
        if (!entriesAllowedRef.current || LIVE_ORDERS_ENABLED) {
          return false;
        }
        const latestFit = fitForStrategy(
          samplesRef.current.digits[symbol] ?? [],
          trade.strategy,
        );
        const openCount = Object.keys(paperRef.current.open).length;
        const risk = canPlaceTrade(
          tradingSessionRef.current,
          DEFAULT_RISK_CONFIG,
          Date.now(),
          openCount,
        );
        const recovery = getRecoveryDecision(tradingSessionRef.current);
        const decision = blockArmedEntries(
          runtimeRef.current.phase,
          decideEntry({
            enabled: true,
            open: Boolean(paperRef.current.open[symbol]),
            riskAllowed: risk.allowed && recovery.allowed,
            riskReason: risk.allowed ? recovery.reason : risk.reason,
            minimumConfidence: Math.max(
              definitionForBotStrategy(trade.strategy).parameters.minimumConfidence,
              recovery.minimumConfidence,
            ),
            fit: latestFit,
          }),
        );
        if (
          !mayOpenPaperTrade({
            role: "specialist",
            entryPhase: decision.phase,
            liveOrdersEnabled: LIVE_ORDERS_ENABLED,
            runtimePhase: runtimeRef.current.phase,
          })
        ) {
          return false;
        }
        const tracked: TrackedPaperPosition = {
          ...trade,
          entryDigit: digit,
          entryEpoch: epoch,
          runtimeSessionId: sessionId,
          signalKey: `${symbol}|${trade.strategy}|${epoch}`,
          confidence: latestFit?.probability ?? fit.probability,
          proposalId: trade.proposalId ?? "",
        };
        const committed = commitOpenPosition(paperRef.current, tracked);
        if (!committed.accepted) {
          return false;
        }
        paperRef.current = committed.book;
        const nextForward = openLivePaperRecord(forwardRef.current, {
          id: trade.id,
          strategy: trade.strategy,
          symbol,
          predictedProbability: tracked.confidence,
          askPrice: trade.stake,
          payout: trade.quotedPayout,
          contractType: trade.contractType,
          barrier: trade.barrier,
          openedAt: trade.openedAt,
        });
        forwardRef.current = nextForward;
        setForwardBook(nextForward);
        commitRuntime(
          noteRuntime(
            runtimeRef.current,
            "PAPER_TRADE_OPENED",
            `Paper trade opened ${trade.strategy} on ${symbol}.`,
            Date.now(),
          ),
        );
        return true;
      },
    })
      .then((trade) => {
        if (!trade) {
          proposalBackoffRef.current[symbol] = Date.now() + PROPOSAL_BACKOFF_MS;
          return;
        }
        if (mountedRef.current) {
          setStatusDetail(null);
          publishRef.current(true);
        }
      })
      .catch(() => {
        proposalBackoffRef.current[symbol] = Date.now() + PROPOSAL_BACKOFF_MS;
        if (mountedRef.current) {
          setStatusDetail("Paper proposal quote failed. No paper trade was opened.");
        }
      });
  }

  useEffect(() => {
    mountedRef.current = true;
    const session = retainPublicMarketData({
      onConnectionChange: (state, detail) => {
        connectionRef.current = state;
        if (!mountedRef.current) {
          return;
        }
        setConnectionState(state);
        setStatusDetail(detail ?? null);
      },
      onActiveSymbols: (nextSymbols) => {
        symbolsRef.current = nextSymbols;
        if (!mountedRef.current) {
          return;
        }
        setSymbols(nextSymbols);
      },
      onMarketTick: (snapshot) => {
        handleDigitRef.current(snapshot);
      },
    });
    clientRef.current = session.client;
    return () => {
      mountedRef.current = false;
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
      }
      clientRef.current?.releaseTickSubscriptions("bot-monitor");
      clientRef.current = null;
      session.release();
    };
  }, []);

  const eligible = useMemo(() => discoverEligibleMarkets(symbols), [symbols]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected") {
      return;
    }
    if (runtime.phase === "STOPPED" && Object.keys(paperRef.current.open).length === 0) {
      client.releaseTickSubscriptions("bot-monitor");
      return;
    }
    const codes = eligible.map((market: EligibleMarket) => market.symbol);
    const handle = window.setTimeout(() => {
      client.setTickSubscriptions(codes, "bot-monitor", 2);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [connectionState, eligible, runtime.phase]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionState !== "connected" || runtime.phase === "STOPPED") {
      return;
    }
    const pending = eligible
      .map((market) => market.symbol)
      .filter((symbol) => {
        const known = contractsRef.current[symbol];
        if (!known) {
          return true;
        }
        if (known.status !== "unknown") {
          return false;
        }
        return Date.now() >= (contractRetryRef.current[symbol] ?? 0);
      });
    if (pending.length === 0) {
      return;
    }
    let cancelled = false;
    void probeDigitContracts(client, pending, () => cancelled, (symbol, parsed) => {
      contractsRef.current = { ...contractsRef.current, [symbol]: parsed };
      if (parsed.status === "unknown") {
        contractRetryRef.current[symbol] = Date.now() + CONTRACT_RETRY_MS;
      }
    }).then(() => {
      if (!cancelled && mountedRef.current) {
        publishRef.current(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connectionState, eligible, runtime.phase]);

  useEffect(() => {
    if (!runtime.session || runtime.phase === "STOPPED") {
      return;
    }
    const handle = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [runtime.phase, runtime.session]);

  useEffect(() => {
    if (runtime.phase !== "COOLDOWN" || !runtime.session?.cooldownUntil) {
      return;
    }
    const until = runtime.session.cooldownUntil;
    let handle = 0;
    const wait = () => {
      const remaining = until - Date.now();
      if (remaining <= 0) {
        const result = dispatchRuntime(
          runtimeRef.current,
          "COOLDOWN_EXPIRED",
          Date.now(),
          runtimeRef.current.session?.cooldownDurationMs ?? runtimeRef.current.cooldownDurationMs,
        );
        if (!result.accepted) {
          return;
        }
        commitRuntime(result.state);
        setRuntime(result.state);
        publishRef.current(true);
        return;
      }
      handle = window.setTimeout(wait, Math.min(remaining, 2_147_483_647));
    };
    wait();
    return () => window.clearTimeout(handle);
  }, [runtime.phase, runtime.session]);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    sessionStorage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(performanceBook));
  }, [performanceBook]);

  useEffect(() => {
    forwardRef.current = forwardBook;
    writeLivePaperBook(forwardBook);
  }, [forwardBook]);

  useEffect(() => {
    setLoadedBotId(readLoadedBotId());
  }, []);

  useEffect(() => {
    if (!runtime.session || runtime.phase === "STOPPED") {
      return;
    }
    const count = eligible.length;
    if (discoveryCountRef.current === count) {
      return;
    }
    discoveryCountRef.current = count;
    let next = noteRuntime(
      runtimeRef.current,
      "MARKET_DISCOVERY_COMPLETE",
      `Discovered ${count} eligible synthetic markets.`,
      Date.now(),
    );
    next = noteRuntime(
      next,
      "MARKET_SUBSCRIBED",
      `Subscribed ${count} markets on the shared public socket.`,
      Date.now(),
    );
    commitRuntime(next);
    setRuntime(next);
  }, [eligible, runtime.phase, runtime.session]);

  function changeCooldown(raw: string) {
    setCooldownInput(raw);
    const parsed = parseCooldownSeconds(raw);
    if (!parsed.ok) {
      setCooldownError(parsed.reason);
      return;
    }
    const selected = selectCooldownDuration(runtimeRef.current, parsed.seconds);
    if (!selected.accepted) {
      setCooldownError(selected.reason);
      return;
    }
    setCooldownError(null);
    commitRuntime(selected.state);
    setRuntime(selected.state);
  }

  function applyRuntime(command: RuntimeCommand) {
    let current = runtimeRef.current;
    if (command === "COOLDOWN") {
      const parsed = parseCooldownSeconds(cooldownInput);
      if (!parsed.ok) {
        setCooldownError(parsed.reason);
        return;
      }
      const selected = selectCooldownDuration(current, parsed.seconds);
      if (!selected.accepted) {
        setCooldownError(selected.reason);
        return;
      }
      current = selected.state;
      setCooldownError(null);
    }
    const result = dispatchRuntime(
      current,
      command,
      Date.now(),
      current.session?.cooldownDurationMs ?? current.cooldownDurationMs,
    );
    if (!result.accepted) {
      return;
    }
    let next = result.state;
    if (command === "RUN") {
      const fresh = createTradingSession();
      tradingSessionRef.current = fresh;
      setTradingSession(fresh);
      discoveryCountRef.current = -1;
      next = noteRuntime(
        next,
        "MARKET_DISCOVERY_STARTED",
        "Market discovery started.",
        Date.now(),
      );
    }
    commitRuntime(next);
    setRuntime(next);
    publish(true);
  }

  handleDigitRef.current = handleDigit;
  publishRef.current = publish;

  const loadedCard = FREE_BOT_GALLERY.find((item) => item.galleryId === loadedBotId);
  const loadedPreset = presetById(loadedCard?.presetId ?? loadedBotId);
  const masterRole = resolveActiveMasterRole(loadedPreset, loadedCard?.specialist);
  const recovery = getRecoveryDecision(tradingSession);
  const entryByStrategy = useMemo(() => {
    const decisions = {} as Record<BotStrategy, EntryDecision>;
    for (const bot of SPECIALIST_BOTS) {
      const slot = routerModel.assigned[bot.id];
      decisions[bot.id] = slot
        ? routerModel.entries[slot.symbol] ?? {
            phase: "WATCHING",
            armed: false,
            reason: slot.reason ?? "Watching the assigned market",
          }
        : { phase: "IDLE", armed: false, reason: "No qualified assignment" };
    }
    return decisions;
  }, [routerModel]);
  const assignmentCounts = useMemo(() => {
    const counts: Partial<Record<BotStrategy, number>> = {};
    for (const item of Object.values(routerModel.assignments)) {
      counts[item.strategy] = (counts[item.strategy] ?? 0) + 1;
    }
    return counts;
  }, [routerModel.assignments]);
  const panelStrategies = useMemo(
    () => new Set(SPECIALIST_BOTS.map((bot) => bot.id)),
    [],
  );
  const topRow = routerModel.rows[0] ?? null;
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
              RUN discovers the eligible synthetic universe, ranks market and specialist
              pairs, and lets qualified markets paper-trade independently.
            </p>
          </div>
        </div>

        <RuntimeControlBar
          state={runtime}
          now={clock}
          markets={routerModel.discovered}
          candidate={topRow ? `${topRow.specialist} ${topRow.symbol}` : "None"}
          specialist={
            topRow ? `${topRow.specialist} ${topRow.symbol}` : "None"
          }
          signalState={
            openPositions.length > 0
              ? `${openPositions.length} PAPER`
              : topRow?.state ?? (runtime.phase === "RUNNING" ? "WATCHING" : runtime.phase)
          }
          openPositions={openPositions}
          cooldownSeconds={cooldownInput}
          cooldownError={cooldownError}
          onCooldownSecondsChange={changeCooldown}
          onCommand={applyRuntime}
        />

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
            live={runtime.phase === "RUNNING" && connectionState === "connected"}
            label={`Master: ${
              runtime.phase === "RUNNING"
                ? masterRole === "router"
                  ? "Routing"
                  : masterRole === "entry"
                    ? "Gating"
                    : "Specialist"
                : runtime.phase
            }`}
          />
          <StatusChip label={`Specialists: ${SPECIALIST_BOTS.length}`} />
        </div>
      </header>

      <BotGallery
        loadedPresetId={loadedBotId}
        cardState={(item) => {
          const slot = item.specialist ? routerModel.assigned[item.specialist] : null;
          const entry = item.specialist ? entryByStrategy[item.specialist] : null;
          const loaded = loadedBotId === item.galleryId;
          return {
            loaded,
            status: entry?.phase ?? (loaded ? "LOADED" : "IDLE"),
            assignedMarket: slot?.marketName,
            confidence: slot ? `${(slot.confidence * 100).toFixed(1)}%` : undefined,
            ready: entry?.phase === "ARMED",
            reason: entry?.reason ?? slot?.reason,
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

      {runtime.phase !== "STOPPED" ? (
        <MarketRouterPanel
          discovered={routerModel.discovered}
          subscribed={routerModel.subscribed}
          sufficient={routerModel.sufficient}
          qualified={routerModel.qualified}
          assignments={routerModel.assignmentCount}
          openPositions={openPositions.length}
          maxOpen={DEFAULT_RISK_CONFIG.maxOpenPaperPositions}
          rows={routerModel.rows}
        />
      ) : null}

      <MasterControlPanel
        roleTitle={
          masterRole === "router"
            ? "Market Router"
            : masterRole === "entry"
              ? "Entry Signal Hunter"
              : loadedCard?.name ?? "Specialist"
        }
        statusLabel={runtime.phase}
        connectionLabel={connectionLabel(connectionState)}
        recoveryReason={recovery.reason}
        recoveryMode={recovery.recoveryMode}
        marketsScanned={routerModel.discovered}
        ranked={routerModel.ranked}
        assigned={routerModel.assigned}
        profitLoss={tradingSession.profitLoss}
        wins={tradingSession.wins}
        losses={tradingSession.losses}
        openPositions={openPositions}
      />

      <ActiveBotPanel
        assigned={routerModel.assigned}
        marketTicks={marketTicks}
        allowedStrategies={panelStrategies}
        openPositions={openPositions}
        assignmentCounts={assignmentCounts}
        cooldown={cooldownActive}
        entries={entryByStrategy}
      />

      <section className="overflow-hidden rounded-2xl border border-border bg-[#141922]">
        <div className="border-b border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
            Paper transactions
          </p>
          <p className="mt-1 text-xs text-muted">
            Simulated from proposal quotes. Missing quote economics stay unavailable.
          </p>
        </div>
        <div className="overflow-x-auto px-4 py-3">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.1em] text-muted">
                <th className="pb-2 pr-3 font-medium">Market</th>
                <th className="pb-2 pr-3 font-medium">Strategy</th>
                <th className="pb-2 pr-3 font-medium">Contract</th>
                <th className="pb-2 pr-3 font-medium">Entry</th>
                <th className="pb-2 pr-3 font-medium">Exit</th>
                <th className="pb-2 pr-3 font-medium">Stake</th>
                <th className="pb-2 pr-3 font-medium">Result</th>
                <th className="pb-2 font-medium">Simulated P/L</th>
              </tr>
            </thead>
            <tbody>
              {openPositions.length === 0 && settledTrades.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-4 text-muted">
                    No paper positions yet.
                  </td>
                </tr>
              ) : (
                [...openPositions, ...settledTrades].map((trade) => (
                  <tr key={trade.id} className="border-t border-border">
                    <td className="py-2 pr-3 text-foreground">{trade.symbol}</td>
                    <td className="py-2 pr-3 text-foreground">{trade.strategy}</td>
                    <td className="py-2 pr-3 text-muted">
                      {trade.contractType}
                      {trade.barrier !== undefined ? ` ${trade.barrier}` : ""}
                    </td>
                    <td className="py-2 pr-3 font-mono text-muted">{trade.entryDigit}</td>
                    <td className="py-2 pr-3 font-mono text-muted">{trade.exitDigit ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-muted">{trade.stake.toFixed(2)}</td>
                    <td className="py-2 pr-3 text-foreground">{trade.status}</td>
                    <td className="py-2 font-mono text-foreground">{simulatedResultLabel(trade)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {lastClosed ? (
        <p className="text-sm text-muted">
          Last paper result: {lastClosed.status} on {lastClosed.symbol} ({simulatedResultLabel(lastClosed)})
        </p>
      ) : null}

      {runtime.phase === "STOPPED" ? (
        <p className="text-sm text-muted">
          Runtime is stopped. Press RUN to discover the eligible synthetic universe.
          Real-money orders stay disabled.
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

async function probeDigitContracts(
  client: PublicMarketDataClient,
  symbols: string[],
  isCancelled: () => boolean,
  onUpdate: (symbol: string, contracts: ParsedDigitContracts) => void,
): Promise<void> {
  const queue = [...symbols];
  const workers = Array.from({ length: CONTRACT_PROBE_CONCURRENCY }, async () => {
    while (queue.length > 0 && !isCancelled()) {
      const symbol = queue.shift();
      if (!symbol) {
        return;
      }
      try {
        const payload = await client.requestContractsFor({
          contracts_for: symbol,
        });
        onUpdate(symbol, parseDigitContracts(payload));
      } catch {
        onUpdate(symbol, unknownDigitContracts());
      }
    }
  });
  await Promise.all(workers);
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
