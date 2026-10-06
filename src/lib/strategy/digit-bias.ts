import { buildDigitDistribution } from "./digit-distribution";

export type StrategyState = "COLLECTING" | "MONITORING" | "SIGNAL";

export type DigitAnalysis = {
  strategy: "Digit Bias";
  state: StrategyState;
  dominantDigit: number | null;
  dominantFrequency: number | null;
  sampleSize: number;
};

export function analyzeDigitBias(digits: number[]): DigitAnalysis {
  const sampleSize = digits.length;

  if (sampleSize < 10) {
    return {
      strategy: "Digit Bias",
      state: "COLLECTING",
      dominantDigit: null,
      dominantFrequency: null,
      sampleSize,
    };
  }

  const distribution = buildDigitDistribution(digits);
  const dominantDigit = distribution.hottestDigit ?? 0;
  const dominantFrequency = (distribution.counts[dominantDigit] ?? 0) / sampleSize;

  return {
    strategy: "Digit Bias",
    state: dominantFrequency >= 0.2 ? "SIGNAL" : "MONITORING",
    dominantDigit,
    dominantFrequency,
    sampleSize,
  };
}
