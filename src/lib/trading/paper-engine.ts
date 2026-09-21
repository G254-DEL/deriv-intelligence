import type { BotStrategy, PaperTrade } from "./types";

export function createPaperTrade(params: {
  strategy: BotStrategy;
  symbol: string;
  contractType: string;
  barrier?: number;
  stake: number;
  entryDigit: number;
}): PaperTrade {
  return {
    id: crypto.randomUUID(),
    strategy: params.strategy,
    symbol: params.symbol,
    contractType: params.contractType,
    barrier: params.barrier,
    stake: params.stake,
    entryDigit: params.entryDigit,
    status: "OPEN",
    payout: 0,
    profitLoss: 0,
    openedAt: Date.now(),
  };
}

export function settlePaperTrade(
  trade: PaperTrade,
  exitDigit: number,
  won: boolean,
  payout: number,
): PaperTrade {
  const actualPayout = won ? payout : 0;

  return {
    ...trade,
    exitDigit,
    status: won ? "WON" : "LOST",
    payout: actualPayout,
    profitLoss: actualPayout - trade.stake,
    closedAt: Date.now(),
  };
}
