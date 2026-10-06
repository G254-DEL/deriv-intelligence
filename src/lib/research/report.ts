import type { TickDataset } from "./dataset";
import { classifyValidation, profitShare, VALIDATION_GATES, type ValidationStatus } from "./gates";
import type { StrategyMetrics } from "./metrics";
import { listOrchestration, listStrategies } from "./registry";
import { replayStrategy, type SignalEvent } from "./replay";
import { expandingWalkForward, splitChronological } from "./splits";
import {
  REAL_DATA_REQUIRED,
  type OrchestrationDefinition,
  type StrategyDefinition,
} from "./strategy-spec";

export type SliceView = {
  tickCount: number;
  metrics: StrategyMetrics | null;
  bySymbol: Array<{ symbol: string; metrics: StrategyMetrics }>;
  audit: SignalEvent[];
  status: ValidationStatus;
  reasons: string[];
};

export type WalkForwardView = {
  id: string;
  trainTicks: number;
  evaluationTicks: number;
  metrics: StrategyMetrics;
};

export type StrategyResearchView = {
  definition: StrategyDefinition;
  trainTicks: number;
  validation: SliceView;
  test: SliceView;
  walkForward: WalkForwardView[];
  displayedStatus: ValidationStatus;
};

export type LabReport = {
  dataStatus: string;
  origin: "none" | "real" | "synthetic";
  datasetLabel: string | null;
  tickCount: number;
  trainTicks: number;
  validationTicks: number;
  testTicks: number;
  strategies: StrategyResearchView[];
  orchestration: readonly OrchestrationDefinition[];
  gates: typeof VALIDATION_GATES;
};

export function buildLabReport(dataset: TickDataset | null): LabReport {
  if (!dataset || dataset.ticks.length === 0) {
    return {
      dataStatus: REAL_DATA_REQUIRED,
      origin: "none",
      datasetLabel: null,
      tickCount: 0,
      trainTicks: 0,
      validationTicks: 0,
      testTicks: 0,
      strategies: listStrategies().map((definition) => emptyStrategy(definition)),
      orchestration: listOrchestration(),
      gates: VALIDATION_GATES,
    };
  }

  const split = splitChronological(dataset.ticks);
  return {
    dataStatus:
      dataset.origin === "real"
        ? "Real dataset loaded. Backtest figures are separate from live paper."
        : `Synthetic dataset. ${REAL_DATA_REQUIRED}`,
    origin: dataset.origin,
    datasetLabel: dataset.label,
    tickCount: dataset.ticks.length,
    trainTicks: split.train.length,
    validationTicks: split.validation.length,
    testTicks: split.test.length,
    strategies: listStrategies().map((definition) => researchFrozenStrategy(dataset, definition)),
    orchestration: listOrchestration(),
    gates: VALIDATION_GATES,
  };
}

export function researchFrozenStrategy(
  dataset: TickDataset,
  definition: StrategyDefinition,
): StrategyResearchView {
  const split = splitChronological(dataset.ticks);
  const preTest = [...split.train, ...split.validation];
  const validationKeys = keySet(split.validation);
  const testKeys = keySet(split.test);
  const validationReplay = replayStrategy({
    definition,
    ticks: preTest,
    scoreTick: (tick) => validationKeys.has(keyOf(tick.symbol, tick.epoch)),
  });
  const testReplay = replayStrategy({
    definition,
    ticks: dataset.ticks,
    scoreTick: (tick) => testKeys.has(keyOf(tick.symbol, tick.epoch)),
  });
  const walkForward = expandingWalkForward(preTest, 3).map((window) => {
    const keys = keySet(window.evaluation);
    return {
      id: window.id,
      trainTicks: window.train.length,
      evaluationTicks: window.evaluation.length,
      metrics: replayStrategy({
        definition,
        ticks: [...window.train, ...window.evaluation],
        scoreTick: (tick) => keys.has(keyOf(tick.symbol, tick.epoch)),
      }).metrics,
    };
  });
  const windowShare = profitShare(
    walkForward.map((window) => window.metrics.totalProfitLoss ?? 0),
  );
  const validation = sliceView(
    dataset.origin,
    "validation",
    split.validation.length,
    validationReplay,
    walkForward,
    windowShare,
  );
  const test = sliceView(
    dataset.origin,
    "test",
    split.test.length,
    testReplay,
    walkForward,
    windowShare,
  );
  return {
    definition,
    trainTicks: split.train.length,
    validation,
    test,
    walkForward,
    displayedStatus: test.status,
  };
}

function sliceView(
  origin: TickDataset["origin"],
  slice: "validation" | "test",
  tickCount: number,
  replay: ReturnType<typeof replayStrategy>,
  walkForward: WalkForwardView[],
  windowShare: number | null,
): SliceView {
  const classified = classifyValidation({
    origin,
    slice,
    metrics: replay.metrics,
    walkForwardWindows: walkForward.length,
    walkForwardAllPositive: walkForward.every(
      (window) => (window.metrics.expectedValuePerTrade ?? -1) > 0,
    ),
    maxWindowProfitShare: windowShare,
    maxSymbolProfitShare: profitShare(
      replay.bySymbol.map((item) => item.metrics.totalProfitLoss ?? 0),
    ),
    parameterSelectionUsedTest: false,
  });
  return {
    tickCount,
    metrics: replay.metrics,
    bySymbol: replay.bySymbol,
    audit: replay.audit.slice(0, 12),
    status: classified.status,
    reasons: classified.reasons,
  };
}

function emptyStrategy(definition: StrategyDefinition): StrategyResearchView {
  const empty = emptySlice();
  return {
    definition,
    trainTicks: 0,
    validation: empty,
    test: empty,
    walkForward: [],
    displayedStatus: "INSUFFICIENT_DATA",
  };
}

function emptySlice(): SliceView {
  return {
    tickCount: 0,
    metrics: null,
    bySymbol: [],
    audit: [],
    status: "INSUFFICIENT_DATA",
    reasons: [REAL_DATA_REQUIRED],
  };
}

function keySet(ticks: readonly { symbol: string; epoch: number }[]): Set<string> {
  return new Set(ticks.map((tick) => keyOf(tick.symbol, tick.epoch)));
}

function keyOf(symbol: string, epoch: number): string {
  return `${symbol}|${epoch}`;
}
