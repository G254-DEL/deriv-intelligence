import {
  assignSpecialistMarkets,
  rankOpportunities,
  type RankedOpportunity,
} from "./master-bot";
import {
  performanceAdjustment,
  performanceKey,
  type PaperPerformanceBook,
} from "./performance-memory";
import { evaluateSpecialists } from "./specialist-edge";
import type { BotStrategy } from "./types";

export function routeMarkets(params: {
  markets: Array<{ symbol: string; marketName: string; digits: number[] }>;
  performance: PaperPerformanceBook;
  excludeSymbols?: ReadonlySet<string>;
}): {
  ranked: RankedOpportunity[];
  assigned: Record<BotStrategy, RankedOpportunity | null>;
} {
  const avoided = new Set<string>();
  for (const record of params.performance.records) {
    if (record.consecutiveLosses >= 2) {
      avoided.add(performanceKey(record.market, record.strategy));
    }
  }

  const candidates: RankedOpportunity[] = [];
  for (const market of params.markets) {
    for (const fit of evaluateSpecialists(market.digits)) {
      if (avoided.has(performanceKey(market.symbol, fit.strategy))) {
        continue;
      }
      const adjustment = fit.qualified
        ? performanceAdjustment(params.performance, market.symbol, fit.strategy)
        : 0;
      candidates.push({
        symbol: market.symbol,
        marketName: market.marketName,
        strategy: fit.strategy,
        confidence: fit.probability,
        dominantDigit: fit.barrier ?? (fit.evenOddSide === "ODD" ? 1 : 0),
        sampleSize: fit.sampleSize,
        ready: fit.qualified,
        rankScore: fit.probability + adjustment,
        probability: fit.probability,
        edge: fit.edge,
        reason: fit.reason,
        contractType: fit.contractType,
        barrier: fit.barrier,
        evenOddSide: fit.evenOddSide,
      });
    }
  }

  const ranked = rankOpportunities(candidates);
  return {
    ranked,
    assigned: assignSpecialistMarkets(ranked, params.excludeSymbols ?? new Set()),
  };
}
