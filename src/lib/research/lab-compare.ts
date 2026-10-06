import type { ContractPerformance } from "./lab-replay";

export type CompareFlag = "improvement" | "regression" | "unchanged" | "not-comparable";

export type CompareMetric = {
  label: string;
  values: Array<string>;
  flags: CompareFlag[];
};

export type LabComparison = {
  names: string[];
  metrics: CompareMetric[];
  winner: null;
  note: string;
};

export function compareLabResults(
  rows: Array<{ name: string; performance: ContractPerformance }>,
): LabComparison {
  const baseline = rows[0];
  const metric = (
    label: string,
    read: (performance: ContractPerformance) => number | null,
    higherIsBetter: boolean,
  ): CompareMetric => ({
    label,
    values: rows.map((row) => formatMetric(read(row.performance))),
    flags: rows.map((row, index) => {
      if (!baseline || index === 0) {
        return "unchanged";
      }
      return flagDelta(read(baseline.performance), read(row.performance), higherIsBetter);
    }),
  });

  return {
    names: rows.map((row) => row.name),
    metrics: [
      metric("Signals", (item) => item.signals, true),
      metric("Trades", (item) => item.trades, false),
      metric("Wins", (item) => item.wins, true),
      metric("Losses", (item) => item.losses, false),
      metric("Win rate", (item) => item.winRate, true),
      metric("Max loss streak", (item) => item.maximumConsecutiveLosses, false),
      metric("Average edge", (item) => item.averageEdge, true),
      metric(
        "Net P/L",
        (item) => (item.monetaryStatus === "AVAILABLE" ? item.netProfitLoss : null),
        true,
      ),
      metric("Skipped", (item) => item.skipped, false),
      metric("Observations", (item) => item.observations, true),
    ],
    winner: null,
    note: "No variant is selected from win rate alone. Improvements and regressions are shown per metric.",
  };
}

function flagDelta(
  baseline: number | null,
  next: number | null,
  higherIsBetter: boolean,
): CompareFlag {
  if (baseline === null || next === null) {
    return "not-comparable";
  }
  const delta = next - baseline;
  if (Math.abs(delta) < 1e-12) {
    return "unchanged";
  }
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return improved ? "improvement" : "regression";
}

function formatMetric(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : String(Math.round(value * 1000) / 1000);
}
