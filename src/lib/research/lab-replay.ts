import type { NormalizedTick } from "./dataset";
import { replayStrategy, type SignalEvent } from "./replay";
import type { StrategyDefinition } from "./strategy-spec";
import type { LabVariant } from "./lab-variant";
import type { StrategyMetrics } from "./metrics";

export const PNL_UNAVAILABLE =
  "P/L NOT AVAILABLE — HISTORICAL PROPOSAL PRICING NOT CAPTURED";

export type MonetaryStatus = "AVAILABLE" | "NOT_DETERMINED";

export type ContractPerformance = {
  observations: number;
  signals: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  lossRate: number | null;
  currentConsecutiveWins: number;
  currentConsecutiveLosses: number;
  maximumConsecutiveWins: number;
  maximumConsecutiveLosses: number;
  averageEdge: number | null;
  skipped: number;
  skipReasons: Array<{ reason: string; count: number }>;
  sampleSize: number;
  monetaryStatus: MonetaryStatus;
  monetaryNote: string;
  netProfitLoss: number | null;
  totalStake: number | null;
  grossPayout: number | null;
  bySymbol: Array<{
    symbol: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    averageEdge: number | null;
    netProfitLoss: number | null;
  }>;
  tradesTrace: SignalEvent[];
  metrics: StrategyMetrics;
};

export function replayLabVariant(params: {
  definition: StrategyDefinition;
  variant: LabVariant;
  ticks: readonly NormalizedTick[];
  scoreTick?: (tick: NormalizedTick) => boolean;
  scoreFromEpoch?: number;
}): ContractPerformance {
  const result = replayStrategy({
    definition: params.definition,
    ticks: params.ticks,
    parameterOverride: params.variant.parameters,
    scoreTick: params.scoreTick,
    scoreFromEpoch: params.scoreFromEpoch,
  });
  return summarizeContractPerformance(result.metrics, result.audit, result.bySymbol);
}

export function summarizeContractPerformance(
  metrics: StrategyMetrics,
  audit: readonly SignalEvent[],
  bySymbol: Array<{ symbol: string; metrics: StrategyMetrics }>,
): ContractPerformance {
  const armed = [...audit]
    .filter((event) => event.armed)
    .sort((left, right) => left.signalEpoch - right.signalEpoch || left.symbol.localeCompare(right.symbol));
  const streaks = streakStats(armed);
  const priced = armed.filter((event) => event.askPrice !== null && event.profitLoss !== null);
  const monetaryStatus: MonetaryStatus = priced.length > 0 && priced.length === armed.length
    ? "AVAILABLE"
    : "NOT_DETERMINED";
  const skipReasons = new Map<string, number>();
  for (const event of audit) {
    if (event.armed) {
      continue;
    }
    const reason = event.entryReason || "Not armed";
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
  }
  const unqualified = Math.max(0, metrics.observations - metrics.signals);
  if (unqualified > 0) {
    skipReasons.set(
      "Sample or edge did not qualify",
      (skipReasons.get("Sample or edge did not qualify") ?? 0) + unqualified,
    );
  }

  return {
    observations: metrics.observations,
    signals: metrics.signals,
    trades: armed.length,
    wins: armed.filter((event) => event.won === true).length,
    losses: armed.filter((event) => event.won === false).length,
    winRate: rate(armed.filter((event) => event.won === true).length, armed.length),
    lossRate: rate(armed.filter((event) => event.won === false).length, armed.length),
    ...streaks,
    averageEdge: metrics.averageStatisticalEdge,
    skipped: [...skipReasons.values()].reduce((sum, count) => sum + count, 0),
    skipReasons: [...skipReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    sampleSize: metrics.observations,
    monetaryStatus,
    monetaryNote:
      monetaryStatus === "AVAILABLE"
        ? "Net P/L uses captured proposal ask and payout."
        : PNL_UNAVAILABLE,
    netProfitLoss:
      monetaryStatus === "AVAILABLE"
        ? priced.reduce((sum, event) => sum + (event.profitLoss ?? 0), 0)
        : null,
    totalStake:
      monetaryStatus === "AVAILABLE"
        ? priced.reduce((sum, event) => sum + (event.askPrice ?? 0), 0)
        : null,
    grossPayout:
      monetaryStatus === "AVAILABLE"
        ? priced.reduce((sum, event) => sum + (event.won ? event.payout ?? 0 : 0), 0)
        : null,
    bySymbol: bySymbol.map((row) => {
      const symbolEvents = armed.filter((event) => event.symbol === row.symbol);
      const wins = symbolEvents.filter((event) => event.won === true).length;
      return {
        symbol: row.symbol,
        trades: symbolEvents.length,
        wins,
        losses: symbolEvents.filter((event) => event.won === false).length,
        winRate: rate(wins, symbolEvents.length),
        averageEdge: row.metrics.averageStatisticalEdge,
        netProfitLoss: monetaryStatus === "AVAILABLE" ? row.metrics.totalProfitLoss : null,
      };
    }),
    tradesTrace: armed,
    metrics,
  };
}

export function chronologicalHoldout(ticks: readonly NormalizedTick[], developmentRatio = 0.7): {
  development: NormalizedTick[];
  holdout: NormalizedTick[];
} | null {
  if (developmentRatio <= 0 || developmentRatio >= 1 || ticks.length < 2) {
    return null;
  }
  const ordered = [...ticks].sort(
    (left, right) => left.epoch - right.epoch || left.symbol.localeCompare(right.symbol),
  );
  const cut = Math.floor(ordered.length * developmentRatio);
  if (cut < 1 || cut >= ordered.length) {
    return null;
  }
  return {
    development: ordered.slice(0, cut),
    holdout: ordered.slice(cut),
  };
}

function rate(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

function streakStats(events: readonly SignalEvent[]): {
  currentConsecutiveWins: number;
  currentConsecutiveLosses: number;
  maximumConsecutiveWins: number;
  maximumConsecutiveLosses: number;
} {
  let currentWins = 0;
  let currentLosses = 0;
  let maxWins = 0;
  let maxLosses = 0;
  for (const event of events) {
    if (event.won === true) {
      currentWins += 1;
      currentLosses = 0;
    } else if (event.won === false) {
      currentLosses += 1;
      currentWins = 0;
    }
    maxWins = Math.max(maxWins, currentWins);
    maxLosses = Math.max(maxLosses, currentLosses);
  }
  return {
    currentConsecutiveWins: currentWins,
    currentConsecutiveLosses: currentLosses,
    maximumConsecutiveWins: maxWins,
    maximumConsecutiveLosses: maxLosses,
  };
}
