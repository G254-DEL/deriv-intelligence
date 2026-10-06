import { compareOpportunities, rankOpportunities, type RankedOpportunity } from "./master-bot";
import {
  contractSupported,
  type ParsedDigitContracts,
} from "./market-universe";
import {
  pairsToAvoid,
  performanceAdjustment,
  type PaperPerformanceBook,
} from "./performance-memory";
import { activeBotStrategies } from "../research/registry";
import { digitMatchesFit, evaluateSpecialists, type SpecialistFit } from "./specialist-edge";
import type { BotStrategy } from "./types";

export const RANK_SAMPLE_TARGET = 20;
export const RANK_EDGE_WEIGHT = 0.7;
export const RANK_SAMPLE_WEIGHT = 0.15;
export const RANK_PERSISTENCE_WEIGHT = 0.1;
const PERSISTENCE_CAP = 5;

export type RouterMarket = {
  symbol: string;
  marketName: string;
  digits: number[];
  contracts?: ParsedDigitContracts;
};

export type RouterOpportunity = RankedOpportunity & {
  fairProbability: number;
  performanceAdjustment: number;
  eligible: boolean;
  rank: number | null;
  persistence: number;
  contractAvailable: boolean;
};

export function routeMarkets(params: {
  markets: RouterMarket[];
  performance: PaperPerformanceBook;
  excludeSymbols?: ReadonlySet<string>;
  eligibleStrategies?: ReadonlySet<BotStrategy>;
}): {
  evaluated: RouterOpportunity[];
  ranked: RouterOpportunity[];
  assignments: Record<string, RouterOpportunity>;
  assigned: Record<BotStrategy, RouterOpportunity | null>;
} {
  const avoided = pairsToAvoid(params.performance);
  const excluded = params.excludeSymbols ?? new Set<string>();
  const eligible = params.eligibleStrategies ?? activeBotStrategies();
  const evaluated: RouterOpportunity[] = [];

  for (const market of params.markets) {
    for (const fit of evaluateSpecialists(market.digits)) {
      if (!eligible.has(fit.strategy)) {
        continue;
      }
      evaluated.push(scorePair(market, fit, params.performance, avoided, excluded));
    }
  }

  const ranked: RouterOpportunity[] = rankOpportunities(evaluated)
    .filter((item) => item.ready)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const assignments = assignStrongestPerSymbol(ranked);

  return {
    evaluated,
    ranked,
    assignments,
    assigned: primaryAssignmentByStrategy(assignments),
  };
}

export function rankingScore(params: {
  qualified: boolean;
  edge: number;
  sampleSize: number;
  persistence: number;
  performanceAdjustment: number;
}): number {
  if (!params.qualified) {
    return Number.NEGATIVE_INFINITY;
  }
  const sampleSufficiency = Math.min(1, Math.max(0, params.sampleSize) / RANK_SAMPLE_TARGET);
  const persistence = Math.min(1, Math.max(0, params.persistence));
  return round6(
    params.edge * RANK_EDGE_WEIGHT +
      sampleSufficiency * RANK_SAMPLE_WEIGHT +
      persistence * RANK_PERSISTENCE_WEIGHT +
      params.performanceAdjustment,
  );
}

export function assignStrongestPerSymbol(
  ranked: readonly RouterOpportunity[],
): Record<string, RouterOpportunity> {
  const assignments: Record<string, RouterOpportunity> = {};
  for (const item of ranked) {
    if (!item.ready || assignments[item.symbol]) {
      continue;
    }
    assignments[item.symbol] = item;
  }
  return assignments;
}

export function primaryAssignmentByStrategy(
  assignments: Record<string, RouterOpportunity>,
): Record<BotStrategy, RouterOpportunity | null> {
  const assigned: Record<BotStrategy, RouterOpportunity | null> = {
    UNDER_7: null,
    UNDER_8: null,
    OVER_2: null,
    OVER_3: null,
    EVEN_ODD: null,
  };
  const ordered = Object.values(assignments).sort(compareOpportunities);
  for (const item of ordered) {
    if (!assigned[item.strategy]) {
      assigned[item.strategy] = item;
    }
  }
  return assigned;
}

function scorePair(
  market: RouterMarket,
  fit: SpecialistFit,
  performance: PaperPerformanceBook,
  avoided: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
): RouterOpportunity {
  const persistence = trailingContractPersistence(market.digits, fit);
  const contractAvailable = contractSupported(
    market.contracts,
    fit.contractType,
    fit.barrier,
  );
  const cooled = avoided.has(`${market.symbol}|${fit.strategy}`);
  const symbolExcluded = excluded.has(market.symbol);
  const qualified = fit.qualified && contractAvailable && !cooled && !symbolExcluded;
  const adjustment = qualified
    ? performanceAdjustment(performance, market.symbol, fit.strategy)
    : 0;
  const eligible = qualified;
  let reason = fit.reason;
  if (!contractAvailable) {
    reason = "Digit contract is not available for this market";
  } else if (cooled) {
    reason = "Excluded after consecutive paper losses";
  } else if (symbolExcluded) {
    reason = "Symbol is excluded";
  } else if (qualified) {
    reason = fit.reason;
  }

  return {
    symbol: market.symbol,
    marketName: market.marketName,
    strategy: fit.strategy,
    confidence: fit.probability,
    dominantDigit: fit.barrier ?? (fit.evenOddSide === "ODD" ? 1 : 0),
    sampleSize: fit.sampleSize,
    ready: eligible,
    rankScore: rankingScore({
      qualified: eligible,
      edge: fit.edge,
      sampleSize: fit.sampleSize,
      persistence,
      performanceAdjustment: adjustment,
    }),
    probability: fit.probability,
    edge: fit.edge,
    reason,
    contractType: fit.contractType,
    barrier: fit.barrier,
    evenOddSide: fit.evenOddSide,
    fairProbability: fit.fairProbability,
    performanceAdjustment: adjustment,
    eligible,
    rank: null,
    persistence,
    contractAvailable,
  };
}

export function trailingContractPersistence(digits: number[], fit: SpecialistFit): number {
  let trailing = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = digits[index];
    if (!Number.isInteger(digit) || !digitMatchesFit(digit, fit)) {
      break;
    }
    trailing += 1;
  }
  return Math.min(trailing, PERSISTENCE_CAP) / PERSISTENCE_CAP;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
