export type DriftFlag =
  | "DRIFT_WARNING"
  | "INSUFFICIENT_FORWARD_DATA"
  | "NO_HISTORICAL_BASELINE"
  | "STABLE";

export const DRIFT_THRESHOLDS = Object.freeze({
  minimumRecentTrades: 20,
  hitRateDrop: 0.08,
  expectedValueDrop: 0.05,
  frequencyRatioLow: 0.5,
  frequencyRatioHigh: 2,
});

export function assessDrift(params: {
  historical: {
    hitRate: number | null;
    expectedValuePerTrade: number | null;
    signalRate: number | null;
  } | null;
  recent: {
    trades: number;
    hitRate: number | null;
    observedValuePerTrade: number | null;
    signalRate: number | null;
  };
}): { flag: DriftFlag; reasons: string[] } {
  if (!params.historical) {
    return {
      flag: "NO_HISTORICAL_BASELINE",
      reasons: ["No separate historical validation baseline is available."],
    };
  }
  if (params.recent.trades < DRIFT_THRESHOLDS.minimumRecentTrades) {
    return {
      flag: "INSUFFICIENT_FORWARD_DATA",
      reasons: [`Need ${DRIFT_THRESHOLDS.minimumRecentTrades} settled live-paper trades before a drift flag.`],
    };
  }
  const reasons: string[] = [];
  if (
    params.historical.hitRate !== null &&
    params.recent.hitRate !== null &&
    params.historical.hitRate - params.recent.hitRate >= DRIFT_THRESHOLDS.hitRateDrop
  ) {
    reasons.push("Recent live-paper hit rate is materially below the historical validation hit rate.");
  }
  if (
    params.historical.expectedValuePerTrade !== null &&
    params.recent.observedValuePerTrade !== null &&
    params.historical.expectedValuePerTrade - params.recent.observedValuePerTrade >=
      DRIFT_THRESHOLDS.expectedValueDrop
  ) {
    reasons.push("Recent live-paper value per trade is materially below the historical expected value.");
  }
  if (
    params.historical.signalRate !== null &&
    params.recent.signalRate !== null &&
    params.historical.signalRate > 0 &&
    (params.recent.signalRate / params.historical.signalRate < DRIFT_THRESHOLDS.frequencyRatioLow ||
      params.recent.signalRate / params.historical.signalRate > DRIFT_THRESHOLDS.frequencyRatioHigh)
  ) {
    reasons.push("Recent signal frequency diverges from the historical signal frequency.");
  }
  if (reasons.length === 0) {
    return { flag: "STABLE", reasons: ["Recent live-paper results are inside the drift thresholds."] };
  }
  return { flag: "DRIFT_WARNING", reasons };
}
