import type { DatasetOrigin } from "./dataset";
import type { StrategyMetrics } from "./metrics";
import { REAL_DATA_REQUIRED } from "./strategy-spec";

export const VALIDATION_GATES = Object.freeze({
  minimumObservations: 500,
  minimumOutOfSampleSignals: 200,
  minimumOutOfSampleTrades: 80,
  minimumEconomicExpectancyPerTrade: 0,
  maximumDrawdown: 20,
  maximumConsecutiveLosses: 8,
  maximumAbsoluteCalibrationError: 0.08,
  minimumWalkForwardWindows: 3,
  requireEveryWalkForwardWindowPositive: true,
  minimumSymbolsWithTrades: 2,
  maximumSingleSymbolProfitShare: 0.75,
  maximumSingleWindowProfitShare: 0.75,
  economicSafetyMargin: 0.02,
  minimumTradesForParameterRank: 30,
  hitRateConfidenceZ: 1.96,
  stake: 1,
});

export type ValidationStatus =
  | "INSUFFICIENT_DATA"
  | "NO_EDGE"
  | "UNSTABLE"
  | "REJECTED"
  | "PROMISING"
  | "PAPER_VALIDATED";

export function classifyValidation(params: {
  origin: DatasetOrigin | "none";
  slice: "validation" | "test" | "none";
  metrics: StrategyMetrics | null;
  walkForwardWindows: number;
  walkForwardAllPositive: boolean;
  maxWindowProfitShare: number | null;
  maxSymbolProfitShare: number | null;
  parameterSelectionUsedTest: boolean;
}): { status: ValidationStatus; reasons: string[] } {
  if (params.origin !== "real") {
    return {
      status: "INSUFFICIENT_DATA",
      reasons: [REAL_DATA_REQUIRED, "Synthetic or missing history cannot validate a strategy."],
    };
  }
  const metrics = params.metrics;
  if (
    !metrics ||
    metrics.observations < VALIDATION_GATES.minimumObservations ||
    metrics.signals < VALIDATION_GATES.minimumOutOfSampleSignals ||
    metrics.trades < VALIDATION_GATES.minimumOutOfSampleTrades
  ) {
    return {
      status: "INSUFFICIENT_DATA",
      reasons: [
        `Need at least ${VALIDATION_GATES.minimumObservations} observations, ${VALIDATION_GATES.minimumOutOfSampleSignals} out-of-sample signals, and ${VALIDATION_GATES.minimumOutOfSampleTrades} out-of-sample trades.`,
      ],
    };
  }
  if (params.parameterSelectionUsedTest) {
    return {
      status: "REJECTED",
      reasons: ["Parameter selection used the test slice."],
    };
  }
  if (
    (metrics.maximumDrawdown ?? 0) > VALIDATION_GATES.maximumDrawdown ||
    metrics.maximumConsecutiveLosses > VALIDATION_GATES.maximumConsecutiveLosses
  ) {
    return {
      status: "REJECTED",
      reasons: [
        `Drawdown ${metrics.maximumDrawdown ?? 0} or consecutive losses ${metrics.maximumConsecutiveLosses} exceeded the gate.`,
      ],
    };
  }
  if (metrics.expectedValuePerTrade === null || metrics.actualHitRate === null || metrics.baselineWinRate === null) {
    return {
      status: "INSUFFICIENT_DATA",
      reasons: ["Economic expectancy is unavailable because proposal prices were missing."],
    };
  }
  const clearsBaseline =
    metrics.hitRateInterval !== null && metrics.hitRateInterval.lower > metrics.baselineWinRate;
  if (metrics.expectedValuePerTrade <= VALIDATION_GATES.minimumEconomicExpectancyPerTrade || !clearsBaseline) {
    return {
      status: "NO_EDGE",
      reasons: [
        "Out-of-sample economic expectancy is not positive, or the hit-rate interval does not clear the contract baseline.",
      ],
    };
  }
  const unstable: string[] = [];
  if (
    params.walkForwardWindows < VALIDATION_GATES.minimumWalkForwardWindows ||
    !params.walkForwardAllPositive
  ) {
    unstable.push("Walk-forward windows are missing or not all positive.");
  }
  if ((metrics.absoluteCalibrationError ?? 1) > VALIDATION_GATES.maximumAbsoluteCalibrationError) {
    unstable.push("Calibration error is above 0.08.");
  }
  if (metrics.symbols < VALIDATION_GATES.minimumSymbolsWithTrades) {
    unstable.push("Fewer than two symbols have trades.");
  }
  if (
    params.maxSymbolProfitShare !== null &&
    params.maxSymbolProfitShare > VALIDATION_GATES.maximumSingleSymbolProfitShare
  ) {
    unstable.push("Profit depends on one symbol.");
  }
  if (
    params.maxWindowProfitShare !== null &&
    params.maxWindowProfitShare > VALIDATION_GATES.maximumSingleWindowProfitShare
  ) {
    unstable.push("Profit depends on one walk-forward window.");
  }
  if (unstable.length > 0) {
    return { status: "UNSTABLE", reasons: unstable };
  }
  if (params.slice === "test") {
    return {
      status: "PAPER_VALIDATED",
      reasons: ["Untouched test slice passed the conservative gates. This is not a guarantee of profit."],
    };
  }
  return {
    status: "PROMISING",
    reasons: ["Validation evidence passed the gates. Test confirmation is still separate."],
  };
}

export function profitShare(values: readonly number[]): number | null {
  const positive = values.filter((value) => value > 0);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || positive.length === 0) {
    return null;
  }
  return Math.max(...positive) / total;
}
