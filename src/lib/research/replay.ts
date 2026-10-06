import { groupBySymbol, type NormalizedTick, type ProposalSnapshot } from "./dataset";
import { assessEconomics } from "./economics";
import { evaluateCausalSample } from "./evaluate";
import { computeDigitFeatures, type DigitFeatureSnapshot } from "./features";
import {
  emptyAccumulator,
  finalizeMetrics,
  mergeAccumulators,
  noteSymbol,
  type MetricAccumulator,
  type StrategyMetrics,
} from "./metrics";
import {
  parametersOf,
  type StrategyDefinition,
  type StrategyParameters,
} from "./strategy-spec";
import { openControlledPaperTrade, closeControlledPaperTrade } from "../trading/controller";
import { trailingContractPersistence } from "../trading/market-router";
import { applyProposalQuote } from "../trading/paper-engine";
import {
  pairsToAvoid,
  performanceKey,
  recordPaperOutcome,
  emptyPerformanceBook,
  type PaperPerformanceBook,
} from "../trading/performance-memory";
import { parseProposalQuote } from "../trading/proposal";
import { canPlaceTrade, DEFAULT_RISK_CONFIG, type RiskConfig } from "../trading/risk";
import { createTradingSession, type TradingSession } from "../trading/session";
import { strategyWins } from "../trading/strategy-rules";
import type { EntryPhase } from "../trading/entry-signal";
import type { PaperTrade } from "../trading/types";

export const MAX_AUDIT_EVENTS = 200;

export type SignalEvent = {
  strategyId: string;
  strategyVersion: number;
  symbol: string;
  signalEpoch: number;
  features: DigitFeatureSnapshot;
  sampleDigits: number[];
  sampleSize: number;
  observedFrequency: number;
  predictedProbability: number;
  baselineProbability: number;
  edge: number;
  entryPhase: EntryPhase;
  entryReason: string;
  armed: boolean;
  contractType: string;
  barrier?: number;
  evenOddSide?: "EVEN" | "ODD";
  askPrice: number | null;
  payout: number | null;
  breakEvenProbability: number | null;
  economicEdge: number | null;
  expectedValue: number | null;
  statisticalSignal: boolean;
  economicallyQualified: boolean;
  routerPersistence: number;
  nextDigit: number | null;
  won: boolean | null;
  profitLoss: number | null;
  traded: boolean;
  tradeBlockedReason: string | null;
};

export type ReplayResult = {
  metrics: StrategyMetrics;
  bySymbol: Array<{ symbol: string; metrics: StrategyMetrics }>;
  audit: SignalEvent[];
  maxWindowUsed: number;
  droppedAuditEvents: number;
};

type PendingTrade = {
  settleIndex: number;
  scored: boolean;
  event: SignalEvent;
  trade: PaperTrade | null;
  predicted: number;
  baseline: number;
  edge: number;
  economicEdge: number | null;
  expectedValue: number | null;
};

export function replayStrategy(params: {
  definition: StrategyDefinition;
  ticks: readonly NormalizedTick[];
  parameterOverride?: Partial<StrategyParameters>;
  scoreFromEpoch?: number;
  scoreUntilEpoch?: number;
  scoreTick?: (tick: NormalizedTick) => boolean;
}): ReplayResult {
  const parameters = parametersOf(params.definition, params.parameterOverride);
  const grouped = groupBySymbol(params.ticks);
  const symbolResults: Array<{ symbol: string; metrics: StrategyMetrics }> = [];
  const accumulators: MetricAccumulator[] = [];
  const audit: SignalEvent[] = [];
  let droppedAuditEvents = 0;
  let maxWindowUsed = 0;

  for (const [symbol, series] of grouped) {
    const accumulator = emptyAccumulator();
    noteSymbol(accumulator, symbol);
    const seriesAudit = replaySeries({
      definition: params.definition,
      parameters,
      series,
      accumulator,
      scoreFromEpoch: params.scoreFromEpoch,
      scoreUntilEpoch: params.scoreUntilEpoch,
      scoreTick: params.scoreTick,
      onWindow: (size) => {
        maxWindowUsed = Math.max(maxWindowUsed, size);
      },
    });
    for (const event of seriesAudit) {
      if (audit.length < MAX_AUDIT_EVENTS) {
        audit.push(event);
      } else {
        droppedAuditEvents += 1;
      }
    }
    accumulators.push(accumulator);
    symbolResults.push({ symbol, metrics: finalizeMetrics(accumulator) });
  }

  return {
    metrics: finalizeMetrics(mergeAccumulators(accumulators)),
    bySymbol: symbolResults.sort((left, right) => left.symbol.localeCompare(right.symbol)),
    audit,
    maxWindowUsed,
    droppedAuditEvents,
  };
}

export function explainEntry(event: SignalEvent): string {
  const price =
    event.askPrice === null
      ? "No proposal quote"
      : `Ask ${event.askPrice} payout ${event.payout} break-even ${formatMaybe(event.breakEvenProbability)}`;
  const outcome =
    event.nextDigit === null
      ? "No following tick"
      : `Next digit ${event.nextDigit} ${event.won ? "WIN" : "LOSS"} P/L ${formatMaybe(event.profitLoss)}`;
  return [
    `${event.strategyId} v${event.strategyVersion} ${event.symbol} @ ${event.signalEpoch}`,
    `Digits [${event.sampleDigits.join(",")}] n=${event.sampleSize}`,
    `Observed ${formatMaybe(event.observedFrequency)} predicted ${formatMaybe(event.predictedProbability)} baseline ${formatMaybe(event.baselineProbability)} edge ${formatMaybe(event.edge)}`,
    `Gate ${event.entryPhase}: ${event.entryReason}`,
    price,
    event.economicallyQualified ? "Economic edge passes the safety margin" : "Not economically qualified",
    outcome,
    event.traded ? "Paper trade simulated" : event.tradeBlockedReason ?? "Not traded",
  ].join(" | ");
}

function replaySeries(params: {
  definition: StrategyDefinition;
  parameters: StrategyParameters;
  series: NormalizedTick[];
  accumulator: MetricAccumulator;
  scoreFromEpoch?: number;
  scoreUntilEpoch?: number;
  scoreTick?: (tick: NormalizedTick) => boolean;
  onWindow: (size: number) => void;
}): SignalEvent[] {
  const audit: SignalEvent[] = [];
  let session = createTradingSession();
  let book = emptyPerformanceBook();
  let persistence = 0;
  let tickCooldown = 0;
  let pending: PendingTrade | null = null;
  let scoringSessionReady = params.scoreFromEpoch === undefined;
  const riskConfig: RiskConfig = {
    ...DEFAULT_RISK_CONFIG,
    stake: params.definition.parameters.stake,
    cooldownAfterLossMs: params.parameters.cooldownAfterLossMs,
  };

  for (let index = 0; index < params.series.length; index += 1) {
    const tick = params.series[index];
    if (pending && pending.settleIndex === index) {
      if (!pending.trade) {
        if (pending.scored && pending.event.won === false) {
          tickCooldown = params.parameters.cooldownTicks;
        }
        pending = null;
        continue;
      }
      const settled = settlePending(
        pending.trade,
        tick,
        session,
        book,
        params.definition,
        pending.predicted,
      );
      session = settled.session;
      book = settled.book;
      if (pending.scored) {
        params.accumulator.trades.push({
          epoch: pending.event.signalEpoch,
          symbol: tick.symbol,
          pnl: settled.profitLoss,
          won: settled.won,
          predicted: pending.predicted,
          baseline: pending.baseline,
          statisticalEdge: pending.edge,
          economicEdge: pending.economicEdge,
          expectedValue: pending.expectedValue,
        });
        pending.event.won = settled.won;
        pending.event.profitLoss = settled.profitLoss;
        pending.event.traded = true;
      }
      if (!settled.won) {
        tickCooldown = params.parameters.cooldownTicks;
      }
      pending = null;
      continue;
    }
    if (index === params.series.length - 1) {
      break;
    }

    const scored = params.scoreTick
      ? params.scoreTick(tick)
      : isScored(tick.epoch, params.scoreFromEpoch, params.scoreUntilEpoch);
    if (!scoringSessionReady && scored && !pending) {
      session = createTradingSession();
      scoringSessionReady = true;
    }

    const history = params.series
      .slice(0, index + 1)
      .map((item) => item.lastDigit)
      .slice(-params.parameters.sampleWindow);
    params.onWindow(history.length);
    const preview = evaluateCausalSample({
      digits: history,
      strategy: params.definition.botStrategy,
      thresholds: {
        minimumSampleSize: params.parameters.minimumSampleSize,
        minimumEdge: params.parameters.minimumEdge,
      },
      session,
      confidenceFloor: params.parameters.minimumConfidence,
      open: false,
      riskAllowed: true,
      riskReason: "Trade allowed",
      signalPersistenceMet: true,
      avoidedByPerformance: false,
      tickCooldownActive: false,
    }).fit;
    persistence = preview?.qualified ? persistence + 1 : 0;
    const risk = canPlaceTrade(session, riskConfig, epochToMs(tick.epoch));
    const decision = evaluateCausalSample({
      digits: history,
      strategy: params.definition.botStrategy,
      thresholds: {
        minimumSampleSize: params.parameters.minimumSampleSize,
        minimumEdge: params.parameters.minimumEdge,
      },
      session,
      confidenceFloor: params.parameters.minimumConfidence,
      open: false,
      riskAllowed: risk.allowed,
      riskReason: risk.reason,
      signalPersistenceMet: persistence >= params.parameters.signalPersistence,
      avoidedByPerformance: pairsToAvoid(book).has(
        performanceKey(tick.symbol, params.definition.botStrategy),
      ),
      tickCooldownActive: tickCooldown > 0,
    });
    if (tickCooldown > 0) {
      tickCooldown -= 1;
    }

    const fit = decision.fit;
    const next = params.series[index + 1];
    const contractWon = fit
      ? strategyWins(params.definition.botStrategy, next.lastDigit, fit.evenOddSide ?? "EVEN")
      : false;
    const quote = fit ? matchingQuote(tick, fit.contractType, fit.barrier) : null;
    const economics = assessEconomics(
      fit?.probability ?? 0,
      quote?.askPrice ?? null,
      quote?.payout ?? null,
    );
    const event = buildEvent({
      definition: params.definition,
      tick,
      history,
      fit,
      decision,
      economics,
      quote,
      nextDigit: next.lastDigit,
      contractWon,
      routerPersistence: fit ? trailingContractPersistence(history, fit) : 0,
    });

    if (scored && fit) {
      params.accumulator.observations += 1;
      params.accumulator.unfiltered += 1;
      if (contractWon) {
        params.accumulator.unfilteredWins += 1;
      }
      if (fit.qualified) {
        params.accumulator.signals += 1;
        params.accumulator.statisticalEdgeSum += fit.edge;
        if (contractWon) {
          params.accumulator.signalWins += 1;
        }
      }
      if (economics.economicEdge !== null) {
        params.accumulator.economicEdgeSum += economics.economicEdge;
        params.accumulator.economicEdgeCount += 1;
      }
    }

    if (decision.armed && fit) {
      const opened = tryOpen({
        tick,
        fit,
        session,
        riskConfig,
        quote,
        economicsQualified: economics.economicallyQualified,
        definition: params.definition,
      });
      event.tradeBlockedReason = opened.reason;
      if (opened.trade && opened.session) {
        session = opened.session;
        event.traded = false;
        pending = {
          settleIndex: index + 1,
          scored,
          event,
          trade: opened.trade,
          predicted: fit.probability,
          baseline: fit.fairProbability,
          edge: fit.edge,
          economicEdge: economics.economicEdge,
          expectedValue: economics.expectedValue,
        };
      } else if (!quote) {
        pending = {
          settleIndex: index + 1,
          scored,
          event,
          trade: null,
          predicted: fit.probability,
          baseline: fit.fairProbability,
          edge: fit.edge,
          economicEdge: economics.economicEdge,
          expectedValue: economics.expectedValue,
        };
      }
    } else if (fit?.qualified) {
      event.tradeBlockedReason = decision.reason;
    }

    if (scored && (fit?.qualified || event.traded)) {
      audit.push(event);
    }
  }

  return audit;
}

function tryOpen(params: {
  tick: NormalizedTick;
  fit: NonNullable<ReturnType<typeof evaluateCausalSample>["fit"]>;
  session: TradingSession;
  riskConfig: RiskConfig;
  quote: ProposalSnapshot | null;
  economicsQualified: boolean;
  definition: StrategyDefinition;
}): { trade: PaperTrade | null; session: TradingSession | null; reason: string | null } {
  if (!params.economicsQualified || !params.quote) {
    return { trade: null, session: null, reason: "No economic edge after proposal price" };
  }
  const validated = parseProposalQuote({
    id: `replay-${params.tick.symbol}-${params.tick.epoch}`,
    ask_price: params.quote.askPrice,
    payout: params.quote.payout,
  });
  if (!validated) {
    return { trade: null, session: null, reason: "Proposal quote failed validation" };
  }
  const opened = openControlledPaperTrade(
    params.session,
    {
      strategy: params.definition.botStrategy,
      symbol: params.tick.symbol,
      contractType: params.fit.contractType,
      barrier: params.fit.barrier,
      evenOddSide: params.fit.evenOddSide,
      entryDigit: params.fit.barrier ?? 0,
      confidence: params.fit.probability,
      quote: validated,
      targetProfit: 0,
    },
    params.riskConfig,
  );
  if (!opened.allowed || !opened.trade) {
    return { trade: null, session: null, reason: opened.reason };
  }
  return {
    trade: applyProposalQuote(opened.trade, validated),
    session: params.session,
    reason: null,
  };
}

function settlePending(
  trade: PaperTrade,
  tick: NormalizedTick,
  session: TradingSession,
  book: PaperPerformanceBook,
  definition: StrategyDefinition,
  predicted: number,
): { session: TradingSession; book: PaperPerformanceBook; won: boolean; profitLoss: number } {
  const closed = closeControlledPaperTrade(session, trade, tick.lastDigit, epochToMs(tick.epoch));
  const won = closed.trade.status === "WON";
  return {
    session: closed.session,
    book: recordPaperOutcome(book, {
      market: tick.symbol,
      strategy: definition.botStrategy,
      contractType: trade.contractType,
      barrier: trade.barrier,
      won,
      profitLoss: closed.trade.profitLoss,
      confidence: predicted,
    }),
    won,
    profitLoss: closed.trade.profitLoss,
  };
}

function buildEvent(params: {
  definition: StrategyDefinition;
  tick: NormalizedTick;
  history: number[];
  fit: ReturnType<typeof evaluateCausalSample>["fit"];
  decision: ReturnType<typeof evaluateCausalSample>;
  economics: ReturnType<typeof assessEconomics>;
  quote: ProposalSnapshot | null;
  nextDigit: number;
  contractWon: boolean;
  routerPersistence: number;
}): SignalEvent {
  const fit = params.fit;
  return {
    strategyId: params.definition.strategyId,
    strategyVersion: params.definition.strategyVersion,
    symbol: params.tick.symbol,
    signalEpoch: params.tick.epoch,
    features: computeDigitFeatures(params.history),
    sampleDigits: [...params.history],
    sampleSize: fit?.sampleSize ?? params.history.length,
    observedFrequency: fit?.probability ?? 0,
    predictedProbability: fit?.probability ?? 0,
    baselineProbability: fit?.fairProbability ?? params.definition.baselineProbability,
    edge: fit?.edge ?? 0,
    entryPhase: params.decision.phase,
    entryReason: params.decision.reason,
    armed: params.decision.armed,
    contractType: fit?.contractType ?? params.definition.contractType,
    barrier: fit?.barrier,
    evenOddSide: fit?.evenOddSide,
    askPrice: params.quote?.askPrice ?? null,
    payout: params.quote?.payout ?? null,
    breakEvenProbability: params.economics.breakEvenProbability,
    economicEdge: params.economics.economicEdge,
    expectedValue: params.economics.expectedValue,
    statisticalSignal: Boolean(fit?.qualified),
    economicallyQualified: params.economics.economicallyQualified,
    routerPersistence: params.routerPersistence,
    nextDigit: params.nextDigit,
    won: params.contractWon,
    profitLoss: null,
    traded: false,
    tradeBlockedReason: null,
  };
}

function matchingQuote(
  tick: NormalizedTick,
  contractType: string,
  barrier: number | undefined,
): ProposalSnapshot | null {
  return (
    tick.proposals?.find(
      (proposal) =>
        proposal.contractType === contractType &&
        (barrier === undefined || proposal.barrier === barrier),
    ) ?? null
  );
}

function isScored(epoch: number, from?: number, until?: number): boolean {
  if (from !== undefined && epoch < from) {
    return false;
  }
  if (until !== undefined && epoch >= until) {
    return false;
  }
  return true;
}

function epochToMs(epoch: number): number {
  return epoch > 1e12 ? epoch : epoch * 1000;
}

function formatMaybe(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "n/a" : value.toFixed(4);
}
