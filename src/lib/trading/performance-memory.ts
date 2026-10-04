import type { BotStrategy } from "./types";

export const MAX_PERFORMANCE_BONUS = 0.1;
export const MAX_PERFORMANCE_PENALTY = 0.15;
const RECENT_LIMIT = 8;
const AVOID_AFTER_CONSECUTIVE_LOSSES = 2;

export type PaperOutcome = {
  market: string;
  strategy: BotStrategy;
  contractType: string;
  barrier?: number;
  won: boolean;
  profitLoss: number;
  confidence: number;
};

export type SpecialistStats = PaperOutcome & {
  wins: number;
  losses: number;
  trades: number;
  consecutiveLosses: number;
  recent: Array<{ won: boolean; confidence: number }>;
};

export type PaperPerformanceBook = {
  records: SpecialistStats[];
};

export function emptyPerformanceBook(): PaperPerformanceBook {
  return { records: [] };
}

export function performanceKey(market: string, strategy: BotStrategy): string {
  return `${market}|${strategy}`;
}

export function recordPaperOutcome(
  book: PaperPerformanceBook,
  outcome: PaperOutcome,
): PaperPerformanceBook {
  const key = performanceKey(outcome.market, outcome.strategy);
  const existing = book.records.find(
    (record) => performanceKey(record.market, record.strategy) === key,
  );
  const recent = [...(existing?.recent ?? []), { won: outcome.won, confidence: outcome.confidence }].slice(
    -RECENT_LIMIT,
  );
  const next: SpecialistStats = {
    market: outcome.market,
    strategy: outcome.strategy,
    contractType: outcome.contractType,
    barrier: outcome.barrier,
    won: outcome.won,
    profitLoss: (existing?.profitLoss ?? 0) + outcome.profitLoss,
    confidence: outcome.confidence,
    wins: (existing?.wins ?? 0) + (outcome.won ? 1 : 0),
    losses: (existing?.losses ?? 0) + (outcome.won ? 0 : 1),
    trades: (existing?.trades ?? 0) + 1,
    consecutiveLosses: outcome.won ? 0 : (existing?.consecutiveLosses ?? 0) + 1,
    recent,
  };
  return {
    records: [
      next,
      ...book.records.filter((record) => performanceKey(record.market, record.strategy) !== key),
    ].slice(0, 100),
  };
}

export function statsFor(
  book: PaperPerformanceBook,
  market: string,
  strategy: BotStrategy,
): SpecialistStats | null {
  return (
    book.records.find(
      (record) => performanceKey(record.market, record.strategy) === performanceKey(market, strategy),
    ) ?? null
  );
}

export function performanceAdjustment(
  book: PaperPerformanceBook,
  market: string,
  strategy: BotStrategy,
): number {
  const stats = statsFor(book, market, strategy);
  if (!stats || stats.recent.length < 3) {
    return 0;
  }
  if (stats.consecutiveLosses >= AVOID_AFTER_CONSECUTIVE_LOSSES) {
    return -MAX_PERFORMANCE_PENALTY;
  }
  const wins = stats.recent.filter((item) => item.won).length;
  const rate = wins / stats.recent.length;
  if (rate >= 0.625) {
    return MAX_PERFORMANCE_BONUS;
  }
  if (rate <= 0.375) {
    return -0.1;
  }
  return 0;
}

export function pairsToAvoid(book: PaperPerformanceBook): Set<string> {
  const avoided = new Set<string>();
  for (const record of book.records) {
    if (record.consecutiveLosses >= AVOID_AFTER_CONSECUTIVE_LOSSES) {
      avoided.add(performanceKey(record.market, record.strategy));
    }
  }
  return avoided;
}
