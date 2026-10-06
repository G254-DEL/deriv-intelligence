import type { TickDataset } from "./dataset";
import type { StrategyMetrics } from "./metrics";
import { replayStrategy } from "./replay";
import { expandingWalkForward, splitChronological } from "./splits";
import { VALIDATION_GATES } from "./gates";
import { type StrategyDefinition, type StrategyParameters } from "./strategy-spec";

export const PARAMETER_GRID = {
  sampleWindow: [10, 20, 30],
  minimumEdge: [0.06, 0.08, 0.1],
  minimumConfidence: [0, 0.7],
  signalPersistence: [1, 2],
  cooldownTicks: [0, 2],
} as const;

export const SELECTION_RULE =
  "Rank by validation expectancy with walk-forward stability and neighboring-parameter support. Total profit is not the ranking key. The test slice is not readable here.";

export type ExperimentRecord = {
  id: string;
  parameters: StrategyParameters;
  validation: StrategyMetrics;
  walkForwardExpectancies: Array<number | null>;
  robustnessScore: number | null;
  eligible: boolean;
};

export function enumerateParameterGrid(base: StrategyParameters): StrategyParameters[] {
  const configs: StrategyParameters[] = [];
  for (const sampleWindow of PARAMETER_GRID.sampleWindow) {
    for (const minimumEdge of PARAMETER_GRID.minimumEdge) {
      for (const minimumConfidence of PARAMETER_GRID.minimumConfidence) {
        for (const signalPersistence of PARAMETER_GRID.signalPersistence) {
          for (const cooldownTicks of PARAMETER_GRID.cooldownTicks) {
            configs.push({
              ...base,
              sampleWindow,
              minimumEdge,
              minimumConfidence,
              signalPersistence,
              cooldownTicks,
              stake: base.stake,
            });
          }
        }
      }
    }
  }
  return configs;
}

export function runParameterExperiments(
  dataset: TickDataset,
  definition: StrategyDefinition,
): { records: ExperimentRecord[]; selected: ExperimentRecord | null; rule: string } {
  const split = splitChronological(dataset.ticks);
  const preTest = [...split.train, ...split.validation];
  const validationKeys = new Set(split.validation.map((tick) => tickKey(tick.symbol, tick.epoch)));
  const windows = expandingWalkForward(preTest, 3);
  const records = enumerateParameterGrid(definition.parameters).map((parameters) => {
    const validation = replayStrategy({
      definition,
      ticks: preTest,
      parameterOverride: parameters,
      scoreTick: (tick) => validationKeys.has(tickKey(tick.symbol, tick.epoch)),
    }).metrics;
    const walkForwardExpectancies = windows.map((window) => {
      const keys = new Set(window.evaluation.map((tick) => tickKey(tick.symbol, tick.epoch)));
      return replayStrategy({
        definition,
        ticks: [...window.train, ...window.evaluation],
        parameterOverride: parameters,
        scoreTick: (tick) => keys.has(tickKey(tick.symbol, tick.epoch)),
      }).metrics.expectedValuePerTrade;
    });
    return {
      id: parameterId(parameters),
      parameters,
      validation,
      walkForwardExpectancies,
      robustnessScore: null,
      eligible: false,
    };
  });
  return { ...selectParameterSet(records), rule: SELECTION_RULE };
}

export function selectParameterSet(records: ExperimentRecord[]): {
  records: ExperimentRecord[];
  selected: ExperimentRecord | null;
  rule: string;
} {
  const scored = records.map((record) => {
    const robustnessScore = robustness(record, records);
    const eligible =
      robustnessScore !== null &&
      record.validation.trades >= VALIDATION_GATES.minimumTradesForParameterRank &&
      record.validation.expectedValuePerTrade !== null;
    return { ...record, robustnessScore, eligible };
  });
  const ranked = [...scored].sort((left, right) => {
    const leftScore = left.eligible ? left.robustnessScore ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const rightScore = right.eligible ? right.robustnessScore ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    const calibration =
      (left.validation.absoluteCalibrationError ?? 1) -
      (right.validation.absoluteCalibrationError ?? 1);
    if (calibration !== 0) {
      return calibration;
    }
    return left.id.localeCompare(right.id);
  });
  return {
    records: ranked,
    selected: ranked.find((record) => record.eligible) ?? null,
    rule: SELECTION_RULE,
  };
}

export function confirmParametersOnTest(
  dataset: TickDataset,
  definition: StrategyDefinition,
  parameters: StrategyParameters,
) {
  const split = splitChronological(dataset.ticks);
  const keys = new Set(split.test.map((tick) => tickKey(tick.symbol, tick.epoch)));
  return replayStrategy({
    definition,
    ticks: dataset.ticks,
    parameterOverride: parameters,
    scoreTick: (tick) => keys.has(tickKey(tick.symbol, tick.epoch)),
  });
}

function robustness(record: ExperimentRecord, all: readonly ExperimentRecord[]): number | null {
  if (
    record.validation.trades < VALIDATION_GATES.minimumTradesForParameterRank ||
    record.validation.expectedValuePerTrade === null
  ) {
    return null;
  }
  const windows = record.walkForwardExpectancies.filter((value): value is number => value !== null);
  const spread = standardDeviation(windows);
  const worstWindow = windows.length === 0 ? 0 : Math.min(...windows);
  const neighbors = all.filter((candidate) => isNeighbor(record.parameters, candidate.parameters));
  const supportive = neighbors.filter(
    (candidate) => (candidate.validation.expectedValuePerTrade ?? -1) > 0,
  ).length;
  const neighborFactor = neighbors.length === 0 ? 1 : supportive / neighbors.length;
  return (
    (record.validation.expectedValuePerTrade -
      0.25 * spread -
      0.5 * Math.max(0, -worstWindow) -
      0.1 * (record.validation.absoluteCalibrationError ?? 0)) *
    neighborFactor
  );
}

function isNeighbor(left: StrategyParameters, right: StrategyParameters): boolean {
  const keys = [
    "sampleWindow",
    "minimumEdge",
    "minimumConfidence",
    "signalPersistence",
    "cooldownTicks",
  ] as const;
  let differences = 0;
  for (const key of keys) {
    const grid = PARAMETER_GRID[key];
    const leftIndex = grid.indexOf(left[key] as never);
    const rightIndex = grid.indexOf(right[key] as never);
    if (leftIndex === rightIndex) {
      continue;
    }
    if (leftIndex < 0 || rightIndex < 0 || Math.abs(leftIndex - rightIndex) !== 1) {
      return false;
    }
    differences += 1;
  }
  return differences === 1;
}

function parameterId(parameters: StrategyParameters): string {
  return `w${parameters.sampleWindow}-e${parameters.minimumEdge}-c${parameters.minimumConfidence}-p${parameters.signalPersistence}-k${parameters.cooldownTicks}`;
}

function tickKey(symbol: string, epoch: number): string {
  return `${symbol}|${epoch}`;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
