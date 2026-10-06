import type { NormalizedTick } from "./dataset";

export type ChronologicalSplit = {
  train: NormalizedTick[];
  validation: NormalizedTick[];
  test: NormalizedTick[];
};

export type WalkForwardWindow = {
  id: string;
  train: NormalizedTick[];
  evaluation: NormalizedTick[];
};

export function splitChronological(
  ticks: readonly NormalizedTick[],
  ratios: { train: number; validation: number; test: number } = {
    train: 0.6,
    validation: 0.2,
    test: 0.2,
  },
): ChronologicalSplit {
  const total = ratios.train + ratios.validation + ratios.test;
  if (Math.abs(total - 1) > 1e-9 || ratios.train <= 0 || ratios.validation <= 0 || ratios.test <= 0) {
    throw new Error("Train, validation, and test ratios must be positive and sum to 1.");
  }
  const ordered = [...ticks].sort(
    (left, right) => left.epoch - right.epoch || left.symbol.localeCompare(right.symbol),
  );
  const count = ordered.length;
  const trainCount = Math.floor(count * ratios.train);
  const validationCount = Math.floor(count * ratios.validation);
  return {
    train: ordered.slice(0, trainCount),
    validation: ordered.slice(trainCount, trainCount + validationCount),
    test: ordered.slice(trainCount + validationCount),
  };
}

export function expandingWalkForward(
  ticks: readonly NormalizedTick[],
  folds = 3,
): WalkForwardWindow[] {
  const ordered = [...ticks].sort(
    (left, right) => left.epoch - right.epoch || left.symbol.localeCompare(right.symbol),
  );
  const blocks = folds + 1;
  const blockSize = Math.floor(ordered.length / blocks);
  if (blockSize < 1) {
    return [];
  }
  const windows: WalkForwardWindow[] = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const trainEnd = blockSize * (fold + 1);
    const evaluationEnd = fold === folds - 1 ? ordered.length : blockSize * (fold + 2);
    windows.push({
      id: `WF${fold + 1}`,
      train: ordered.slice(0, trainEnd),
      evaluation: ordered.slice(trainEnd, evaluationEnd),
    });
  }
  return windows;
}
