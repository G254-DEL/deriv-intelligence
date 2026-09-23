import type { DigitAnalysis } from "../strategy/digit-bias";
import type { BotStrategy } from "./types";

export type TradingSignal = {
  strategy: BotStrategy;
  contractType: string;
  barrier?: number;
  entryDigit: number;
  confidence: number;
};

export function createTradingSignal(
  analysis: DigitAnalysis,
): TradingSignal | null {
  if (
    analysis.state !== "SIGNAL" ||
    analysis.dominantDigit === null ||
    analysis.dominantFrequency === null
  ) {
    return null;
  }

  const digit = analysis.dominantDigit;

  if (digit <= 2) {
    return {
      strategy: "OVER_2",
      contractType: "DIGITOVER",
      barrier: 2,
      entryDigit: digit,
      confidence: analysis.dominantFrequency,
    };
  }

  if (digit === 3) {
    return {
      strategy: "OVER_3",
      contractType: "DIGITOVER",
      barrier: 3,
      entryDigit: digit,
      confidence: analysis.dominantFrequency,
    };
  }

  if (digit >= 8) {
    return {
      strategy: "UNDER_8",
      contractType: "DIGITUNDER",
      barrier: 8,
      entryDigit: digit,
      confidence: analysis.dominantFrequency,
    };
  }

  if (digit === 7) {
    return {
      strategy: "UNDER_7",
      contractType: "DIGITUNDER",
      barrier: 7,
      entryDigit: digit,
      confidence: analysis.dominantFrequency,
    };
  }

  return {
    strategy: "EVEN_ODD",
    contractType: digit % 2 === 0 ? "DIGITEVEN" : "DIGITODD",
    entryDigit: digit,
    confidence: analysis.dominantFrequency,
  };
}
