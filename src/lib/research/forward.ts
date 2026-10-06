import { assessEconomics } from "./economics";
import { definitionForBotStrategy } from "./registry";
import type { BotStrategy } from "../trading/types";

export const MAX_FORWARD_EVENTS = 200;
export const FORWARD_STORAGE_KEY = "deriv.intelligence.live-paper-forward";

export type LivePaperEvent = {
  source: "LIVE_PAPER";
  id: string;
  strategyId: string;
  strategyVersion: number;
  symbol: string;
  predictedProbability: number;
  baselineProbability: number;
  edge: number;
  askPrice: number;
  payout: number;
  breakEvenProbability: number | null;
  expectedValue: number | null;
  economicallyQualified: boolean;
  contractType: string;
  barrier?: number;
  openedAt: number;
  settled: boolean;
  won: boolean | null;
  profitLoss: number | null;
  exitDigit: number | null;
};

export type LivePaperBook = {
  events: LivePaperEvent[];
};

export function emptyLivePaperBook(): LivePaperBook {
  return { events: [] };
}

export function openLivePaperRecord(
  book: LivePaperBook,
  input: {
    id: string;
    strategy: BotStrategy;
    symbol: string;
    predictedProbability: number;
    askPrice: number;
    payout: number;
    contractType: string;
    barrier?: number;
    openedAt: number;
  },
): LivePaperBook {
  const definition = definitionForBotStrategy(input.strategy);
  const economics = assessEconomics(input.predictedProbability, input.askPrice, input.payout);
  const event: LivePaperEvent = {
    source: "LIVE_PAPER",
    id: input.id,
    strategyId: definition.strategyId,
    strategyVersion: definition.strategyVersion,
    symbol: input.symbol,
    predictedProbability: input.predictedProbability,
    baselineProbability: definition.baselineProbability,
    edge: input.predictedProbability - definition.baselineProbability,
    askPrice: input.askPrice,
    payout: input.payout,
    breakEvenProbability: economics.breakEvenProbability,
    expectedValue: economics.expectedValue,
    economicallyQualified: economics.economicallyQualified,
    contractType: input.contractType,
    barrier: input.barrier,
    openedAt: input.openedAt,
    settled: false,
    won: null,
    profitLoss: null,
    exitDigit: null,
  };
  return {
    events: [...book.events, event].slice(-MAX_FORWARD_EVENTS),
  };
}

export function settleLivePaperRecord(
  book: LivePaperBook,
  id: string,
  result: { won: boolean; profitLoss: number; exitDigit: number },
): LivePaperBook {
  return {
    events: book.events.map((event) =>
      event.id === id
        ? {
            ...event,
            settled: true,
            won: result.won,
            profitLoss: result.profitLoss,
            exitDigit: result.exitDigit,
          }
        : event,
    ),
  };
}

export function summarizeLivePaper(book: LivePaperBook, strategyId?: string) {
  const events = book.events.filter(
    (event) => event.settled && (strategyId === undefined || event.strategyId === strategyId),
  );
  const wins = events.filter((event) => event.won).length;
  const profit = events.reduce((sum, event) => sum + (event.profitLoss ?? 0), 0);
  const predicted =
    events.length === 0
      ? null
      : events.reduce((sum, event) => sum + event.predictedProbability, 0) / events.length;
  return {
    source: "LIVE_PAPER" as const,
    trades: events.length,
    wins,
    losses: events.length - wins,
    hitRate: events.length === 0 ? null : wins / events.length,
    predictedAverageProbability: predicted,
    profitLoss: events.length === 0 ? null : profit,
    observedValuePerTrade: events.length === 0 ? null : profit / events.length,
  };
}

export function readLivePaperBook(): LivePaperBook {
  if (typeof sessionStorage === "undefined") {
    return emptyLivePaperBook();
  }
  try {
    const raw = sessionStorage.getItem(FORWARD_STORAGE_KEY);
    if (!raw) {
      return emptyLivePaperBook();
    }
    const parsed = JSON.parse(raw) as LivePaperBook;
    if (!parsed || !Array.isArray(parsed.events)) {
      return emptyLivePaperBook();
    }
    return { events: parsed.events.slice(-MAX_FORWARD_EVENTS) };
  } catch {
    return emptyLivePaperBook();
  }
}

export function writeLivePaperBook(book: LivePaperBook): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(
    FORWARD_STORAGE_KEY,
    JSON.stringify({ events: book.events.slice(-MAX_FORWARD_EVENTS) }),
  );
}
