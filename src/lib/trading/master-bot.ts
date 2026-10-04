import type { DigitAnalysis } from "../strategy/digit-bias";
import { createTradingSignal } from "./signal";
import type { BotStrategy } from "./types";

export const SPECIALIST_BOTS: ReadonlyArray<{
  id: BotStrategy;
  label: string;
}> = [
  { id: "UNDER_7", label: "Under 7" },
  { id: "OVER_2", label: "Over 2" },
  { id: "OVER_3", label: "Over 3" },
  { id: "UNDER_8", label: "Under 8" },
  { id: "EVEN_ODD", label: "Even/Odd" },
];

export type RankedOpportunity = {
  symbol: string;
  marketName: string;
  strategy: BotStrategy;
  confidence: number;
  dominantDigit: number;
  sampleSize: number;
  ready: boolean;
};

export function opportunityFromAnalysis(
  symbol: string,
  marketName: string,
  analysis: DigitAnalysis,
): RankedOpportunity | null {
  if (analysis.dominantDigit === null || analysis.dominantFrequency === null) {
    return null;
  }

  const liveSignal = createTradingSignal(analysis);
  if (liveSignal) {
    return {
      symbol,
      marketName,
      strategy: liveSignal.strategy,
      confidence: liveSignal.confidence,
      dominantDigit: liveSignal.entryDigit,
      sampleSize: analysis.sampleSize,
      ready: true,
    };
  }

  if (analysis.state !== "MONITORING") {
    return null;
  }

  const inferred = createTradingSignal({
    ...analysis,
    state: "SIGNAL",
  });
  if (!inferred) {
    return null;
  }

  return {
    symbol,
    marketName,
    strategy: inferred.strategy,
    confidence: inferred.confidence * 0.5,
    dominantDigit: inferred.entryDigit,
    sampleSize: analysis.sampleSize,
    ready: false,
  };
}

export function rankOpportunities(
  items: RankedOpportunity[],
): RankedOpportunity[] {
  return [...items].sort((left, right) => {
    if (left.ready !== right.ready) {
      return left.ready ? -1 : 1;
    }
    return right.confidence - left.confidence;
  });
}

export function assignSpecialistMarkets(
  ranked: RankedOpportunity[],
  excludeSymbols: ReadonlySet<string> = new Set(),
): Record<BotStrategy, RankedOpportunity | null> {
  const assigned: Record<BotStrategy, RankedOpportunity | null> = {
    UNDER_7: null,
    OVER_2: null,
    OVER_3: null,
    UNDER_8: null,
    EVEN_ODD: null,
  };
  const usedSymbols = new Set<string>();

  for (const item of rankOpportunities(ranked)) {
    if (excludeSymbols.has(item.symbol) || usedSymbols.has(item.symbol)) {
      continue;
    }
    if (assigned[item.strategy]) {
      continue;
    }
    assigned[item.strategy] = item;
    usedSymbols.add(item.symbol);
  }

  return assigned;
}
