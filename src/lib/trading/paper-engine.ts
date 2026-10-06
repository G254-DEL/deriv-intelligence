import type { BotStrategy, PaperTrade } from "./types";
import type { PaperProposalQuote } from "./proposal";

export function createPaperTrade(params: {
  strategy: BotStrategy;
  symbol: string;
  contractType: string;
  barrier?: number;
  stake: number;
  quotedPayout: number;
  entryDigit: number;
}): PaperTrade {
  return {
    id: crypto.randomUUID(),
    strategy: params.strategy,
    symbol: params.symbol,
    contractType: params.contractType,
    barrier: params.barrier,
    stake: params.stake,
    quotedPayout: params.quotedPayout,
    entryDigit: params.entryDigit,
    status: "OPEN",
    payout: 0,
    profitLoss: 0,
    openedAt: Date.now(),
  };
}

export function applyProposalQuote(
  trade: PaperTrade,
  quote: PaperProposalQuote,
): PaperTrade {
  return {
    ...trade,
    stake: quote.askPrice,
    quotedPayout: quote.payout,
  };
}

export function simulatedResultLabel(trade: {
  status: string;
  quotedPayout: number;
  profitLoss: number;
}): string {
  if (trade.status === "OPEN") {
    return "open";
  }
  if (!Number.isFinite(trade.quotedPayout) || trade.quotedPayout <= 0) {
    return "unavailable";
  }
  return trade.profitLoss.toFixed(2);
}

export function settlePaperTrade(
  trade: PaperTrade,
  exitDigit: number,
  won: boolean,
): PaperTrade {
  const actualPayout = won ? trade.quotedPayout : 0;

  return {
    ...trade,
    exitDigit,
    status: won ? "WON" : "LOST",
    payout: actualPayout,
    profitLoss: actualPayout - trade.stake,
    closedAt: Date.now(),
  };
}
