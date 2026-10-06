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
  rankScore?: number;
  probability?: number;
  edge?: number;
  reason?: string;
  contractType?: string;
  barrier?: number;
  evenOddSide?: "EVEN" | "ODD";
  fairProbability?: number;
  performanceAdjustment?: number;
  eligible?: boolean;
  rank?: number | null;
  persistence?: number;
  contractAvailable?: boolean;
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

const STRATEGY_SORT: Record<BotStrategy, number> = {
  UNDER_7: 0,
  UNDER_8: 1,
  OVER_2: 2,
  OVER_3: 3,
  EVEN_ODD: 4,
};

export function compareOpportunities(
  left: RankedOpportunity,
  right: RankedOpportunity,
): number {
  if (left.ready !== right.ready) {
    return left.ready ? -1 : 1;
  }
  const rightScore = right.rankScore ?? right.confidence;
  const leftScore = left.rankScore ?? left.confidence;
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  const rightEdge = right.edge ?? 0;
  const leftEdge = left.edge ?? 0;
  if (leftEdge !== rightEdge) {
    return rightEdge - leftEdge;
  }
  if (left.sampleSize !== right.sampleSize) {
    return right.sampleSize - left.sampleSize;
  }
  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }
  if (left.symbol !== right.symbol) {
    return left.symbol < right.symbol ? -1 : 1;
  }
  return STRATEGY_SORT[left.strategy] - STRATEGY_SORT[right.strategy];
}

export function rankOpportunities<T extends RankedOpportunity>(items: T[]): T[] {
  return [...items].sort(compareOpportunities);
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
