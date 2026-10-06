export type RiskConfig = {
  stake: number;
  maxConsecutiveLosses: number;
  maxSessionLoss: number;
  maxTradesPerSession: number;
  maxOpenPaperPositions: number;
  cooldownAfterLossMs: number;
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  stake: 1,
  maxConsecutiveLosses: 3,
  maxSessionLoss: 10,
  maxTradesPerSession: 50,
  maxOpenPaperPositions: 3,
  cooldownAfterLossMs: 5000,
};

import type { TradingSession } from "./session";

export type RiskDecision = {
  allowed: boolean;
  reason: string;
};

export function canPlaceTrade(
  session: TradingSession,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
  now = Date.now(),
  openPositions = 0,
): RiskDecision {
  if (config.stake <= 0) {
    return { allowed: false, reason: "Stake must be greater than zero" };
  }

  const openLimit = config.maxOpenPaperPositions ?? DEFAULT_RISK_CONFIG.maxOpenPaperPositions;
  if (openPositions >= openLimit) {
    return {
      allowed: false,
      reason: `Open paper position limit reached (${openLimit})`,
    };
  }

  const reservedTrades = session.totalTrades + Math.max(0, openPositions);
  if (reservedTrades >= config.maxTradesPerSession) {
    return { allowed: false, reason: "Maximum session trades reached" };
  }

  if (session.profitLoss <= -config.maxSessionLoss) {
    return { allowed: false, reason: "Maximum session loss reached" };
  }

  if (session.consecutiveLosses >= config.maxConsecutiveLosses) {
    return { allowed: false, reason: "Maximum consecutive losses reached" };
  }

  if (
    session.consecutiveLosses > 0 &&
    session.lastLossAt !== null &&
    now - session.lastLossAt < config.cooldownAfterLossMs
  ) {
    return { allowed: false, reason: "Loss cooldown active" };
  }

  return { allowed: true, reason: "Trade allowed" };
}

