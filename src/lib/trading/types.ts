export type BotStrategy =
  | "EVEN_ODD"
  | "OVER_2"
  | "OVER_3"
  | "UNDER_7"
  | "UNDER_8";

export type PaperTradeStatus = "OPEN" | "WON" | "LOST";

export type PaperTrade = {
  id: string;
  strategy: BotStrategy;
  symbol: string;
  contractType: string;
  barrier?: number;
  stake: number;
  entryDigit: number;
  exitDigit?: number;
  status: PaperTradeStatus;
  payout: number;
  profitLoss: number;
  openedAt: number;
  closedAt?: number;
};

export type BotRunStatus = "STOPPED" | "SCANNING" | "TRADING" | "PAUSED";

export type PaperTradingSummary = {
  totalTrades: number;
  wins: number;
  losses: number;
  totalStake: number;
  totalPayout: number;
  profitLoss: number;
};
