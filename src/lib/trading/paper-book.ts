import { closeControlledPaperTrade } from "./controller";
import type { TradingSession } from "./session";
import type { PaperTrade } from "./types";

export type TrackedPaperPosition = PaperTrade & {
  proposalId: string;
  entryEpoch: number;
  runtimeSessionId: string;
  signalKey: string;
  confidence: number;
};

export type PaperPositionBook = {
  open: Record<string, TrackedPaperPosition>;
  proposalIds: string[];
  signalKeys: string[];
};

const MEMORY_LIMIT = 500;

export function emptyPaperBook(): PaperPositionBook {
  return { open: {}, proposalIds: [], signalKeys: [] };
}

export function commitOpenPosition(
  book: PaperPositionBook,
  position: TrackedPaperPosition,
): { book: PaperPositionBook; accepted: boolean; reason: string } {
  if (!position.symbol || !position.proposalId || !position.signalKey) {
    return { book, accepted: false, reason: "Paper position is missing its identity" };
  }
  if (book.open[position.symbol]) {
    return { book, accepted: false, reason: "Symbol already has an open paper position" };
  }
  if (book.proposalIds.includes(position.proposalId)) {
    return { book, accepted: false, reason: "Proposal was already used" };
  }
  if (book.signalKeys.includes(position.signalKey)) {
    return { book, accepted: false, reason: "Signal was already used" };
  }
  if (position.status !== "OPEN") {
    return { book, accepted: false, reason: "Only an open paper position can be committed" };
  }

  return {
    book: {
      open: { ...book.open, [position.symbol]: position },
      proposalIds: remember(book.proposalIds, position.proposalId),
      signalKeys: remember(book.signalKeys, position.signalKey),
    },
    accepted: true,
    reason: "Paper position committed",
  };
}

export function settleSymbolPosition(
  book: PaperPositionBook,
  session: TradingSession,
  symbol: string,
  exitDigit: number,
  epoch: number,
  now = Date.now(),
): {
  book: PaperPositionBook;
  session: TradingSession;
  trade: PaperTrade | null;
  settled: boolean;
} {
  const position = book.open[symbol];
  if (!position || position.status !== "OPEN") {
    return { book, session, trade: null, settled: false };
  }
  if (!(epoch > position.entryEpoch)) {
    return { book, session, trade: null, settled: false };
  }

  const closed = closeControlledPaperTrade(session, position, exitDigit, now);
  const open = { ...book.open };
  delete open[symbol];
  return {
    book: { ...book, open },
    session: closed.session,
    trade: closed.trade,
    settled: closed.trade.status !== "OPEN",
  };
}

function remember(values: string[], value: string): string[] {
  if (values.includes(value)) {
    return values;
  }
  return [...values, value].slice(-MEMORY_LIMIT);
}
