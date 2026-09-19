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

  const counts = Array(10).fill(0) as number[];

  for (const digit of digits) {
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9) {
      counts[digit]++;
    }
  }

  const dominantDigit = counts.indexOf(Math.max(...counts));
  const dominantFrequency = counts[dominantDigit] / sampleSize;

  return {
    strategy: "Digit Bias",
    state: dominantFrequency >= 0.2 ? "SIGNAL" : "MONITORING",
    dominantDigit,
    dominantFrequency,
    sampleSize,
  };
}
