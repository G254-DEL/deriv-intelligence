export type HitRateInterval = {
  lower: number;
  upper: number;
};

export type StrategyMetrics = {
  observations: number;
  signals: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  baselineWinRate: number | null;
  predictedAverageProbability: number | null;
  actualHitRate: number | null;
  hitRateInterval: HitRateInterval | null;
  calibrationError: number | null;
  absoluteCalibrationError: number | null;
  averageStatisticalEdge: number | null;
  averageEconomicEdge: number | null;
  totalProfitLoss: number | null;
  averageProfitLossPerTrade: number | null;
  profitFactor: number | null;
  maximumDrawdown: number | null;
  maximumConsecutiveLosses: number;
  expectedValuePerTrade: number | null;
  observedValuePerTrade: number | null;
  unfilteredHitRate: number | null;
  controlHitRate: number | null;
  liftVersusUnfiltered: number | null;
  liftVersusBaseline: number | null;
  symbols: number;
};

export type CompactTrade = {
  epoch: number;
  symbol: string;
  pnl: number;
  won: boolean;
  predicted: number;
  baseline: number;
  statisticalEdge: number;
  economicEdge: number | null;
  expectedValue: number | null;
};

export type MetricAccumulator = {
  observations: number;
  signals: number;
  signalWins: number;
  unfiltered: number;
  unfilteredWins: number;
  statisticalEdgeSum: number;
  economicEdgeSum: number;
  economicEdgeCount: number;
  symbols: string[];
  trades: CompactTrade[];
};

export function emptyAccumulator(): MetricAccumulator {
  return {
    observations: 0,
    signals: 0,
    signalWins: 0,
    unfiltered: 0,
    unfilteredWins: 0,
    statisticalEdgeSum: 0,
    economicEdgeSum: 0,
    economicEdgeCount: 0,
    symbols: [],
    trades: [],
  };
}

export function noteSymbol(accumulator: MetricAccumulator, symbol: string): void {
  if (!accumulator.symbols.includes(symbol)) {
    accumulator.symbols.push(symbol);
  }
}

export function finalizeMetrics(accumulator: MetricAccumulator): StrategyMetrics {
  const trades = accumulator.trades.length;
  const wins = accumulator.trades.filter((trade) => trade.won).length;
  const losses = trades - wins;
  const predictedSum = accumulator.trades.reduce((sum, trade) => sum + trade.predicted, 0);
  const baselineSum = accumulator.trades.reduce((sum, trade) => sum + trade.baseline, 0);
  const pnl = accumulator.trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const expected = accumulator.trades.reduce((sum, trade) => sum + (trade.expectedValue ?? 0), 0);
  const grossProfit = accumulator.trades
    .filter((trade) => trade.pnl > 0)
    .reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = accumulator.trades
    .filter((trade) => trade.pnl < 0)
    .reduce((sum, trade) => sum + Math.abs(trade.pnl), 0);
  const predicted = trades === 0 ? null : predictedSum / trades;
  const actual = trades === 0 ? null : wins / trades;
  const baseline = trades === 0 ? null : baselineSum / trades;
  const calibration = predicted === null || actual === null ? null : predicted - actual;
  const control = accumulator.observations - accumulator.signals;
  const controlWins = accumulator.unfilteredWins - accumulator.signalWins;
  const unfilteredHitRate =
    accumulator.unfiltered === 0 ? null : accumulator.unfilteredWins / accumulator.unfiltered;
  const signalHitRate = accumulator.signals === 0 ? null : accumulator.signalWins / accumulator.signals;
  const drawdown = maximumDrawdown(accumulator.trades);

  return {
    observations: accumulator.observations,
    signals: accumulator.signals,
    trades,
    wins,
    losses,
    winRate: actual,
    baselineWinRate: baseline,
    predictedAverageProbability: predicted,
    actualHitRate: actual,
    hitRateInterval: trades === 0 ? null : wilsonInterval(wins, trades),
    calibrationError: calibration,
    absoluteCalibrationError: calibration === null ? null : Math.abs(calibration),
    averageStatisticalEdge:
      accumulator.signals === 0 ? null : accumulator.statisticalEdgeSum / accumulator.signals,
    averageEconomicEdge:
      accumulator.economicEdgeCount === 0
        ? null
        : accumulator.economicEdgeSum / accumulator.economicEdgeCount,
    totalProfitLoss: trades === 0 ? null : pnl,
    averageProfitLossPerTrade: trades === 0 ? null : pnl / trades,
    profitFactor: trades === 0 || grossLoss === 0 ? null : grossProfit / grossLoss,
    maximumDrawdown: trades === 0 ? null : drawdown,
    maximumConsecutiveLosses: maxConsecutiveLosses(accumulator.trades),
    expectedValuePerTrade: trades === 0 ? null : expected / trades,
    observedValuePerTrade: trades === 0 ? null : pnl / trades,
    unfilteredHitRate,
    controlHitRate: control <= 0 ? null : controlWins / control,
    liftVersusUnfiltered:
      signalHitRate === null || unfilteredHitRate === null
        ? null
        : signalHitRate - unfilteredHitRate,
    liftVersusBaseline: actual === null || baseline === null ? null : actual - baseline,
    symbols: accumulator.symbols.length,
  };
}

export function mergeAccumulators(parts: readonly MetricAccumulator[]): MetricAccumulator {
  const merged = emptyAccumulator();
  for (const part of parts) {
    merged.observations += part.observations;
    merged.signals += part.signals;
    merged.signalWins += part.signalWins;
    merged.unfiltered += part.unfiltered;
    merged.unfilteredWins += part.unfilteredWins;
    merged.statisticalEdgeSum += part.statisticalEdgeSum;
    merged.economicEdgeSum += part.economicEdgeSum;
    merged.economicEdgeCount += part.economicEdgeCount;
    for (const symbol of part.symbols) {
      noteSymbol(merged, symbol);
    }
    merged.trades.push(...part.trades);
  }
  merged.trades.sort((left, right) => left.epoch - right.epoch || left.symbol.localeCompare(right.symbol));
  return merged;
}

export function wilsonInterval(successes: number, total: number, z = 1.96): HitRateInterval {
  if (total <= 0) {
    return { lower: 0, upper: 0 };
  }
  const proportion = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = proportion + z2 / (2 * total);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z2 / (4 * total)) / total);
  return {
    lower: clamp01((centre - margin) / denominator),
    upper: clamp01((centre + margin) / denominator),
  };
}

export function maximumDrawdown(trades: readonly CompactTrade[]): number {
  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, peak - equity);
  }
  return worst;
}

export function maxConsecutiveLosses(trades: readonly CompactTrade[]): number {
  let streak = 0;
  let worst = 0;
  for (const trade of trades) {
    streak = trade.won ? 0 : streak + 1;
    worst = Math.max(worst, streak);
  }
  return worst;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
