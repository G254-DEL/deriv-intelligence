import type { PaperTrade, PaperTradingSummary } from "./types";

export type TradingSession = PaperTradingSummary & {
  consecutiveLosses: number;
  lastLossAt: number | null;
};

export function createTradingSession(): TradingSession {
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalStake: 0,
    totalPayout: 0,
    profitLoss: 0,
    consecutiveLosses: 0,
    lastLossAt: null,
  };
}

export function recordPaperTrade(
  session: TradingSession,
  trade: PaperTrade,
): TradingSession {
  if (trade.status === "OPEN") {
    return session;
  }

  const won = trade.status === "WON";

  return {
    totalTrades: session.totalTrades + 1,
    wins: session.wins + (won ? 1 : 0),
    losses: session.losses + (won ? 0 : 1),
    totalStake: session.totalStake + trade.stake,
    totalPayout: session.totalPayout + trade.payout,
    profitLoss: session.profitLoss + trade.profitLoss,
    consecutiveLosses: won ? 0 : session.consecutiveLosses + 1,
    lastLossAt: won ? session.lastLossAt : Date.now(),
  };
}
