export type RiskConfig = {
  stake: number;
  maxStake: number;
  maxConsecutiveLosses: number;
  maxSessionLoss: number;
  maxTradesPerSession: number;
  cooldownAfterLossMs: number;
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  stake: 1,
  maxStake: 5,
  maxConsecutiveLosses: 3,
  maxSessionLoss: 10,
  maxTradesPerSession: 50,
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
): RiskDecision {
  if (config.stake <= 0 || config.stake > config.maxStake) {
    return { allowed: false, reason: "Stake outside allowed limits" };
  }

  if (session.totalTrades >= config.maxTradesPerSession) {
    return { allowed: false, reason: "Maximum session trades reached" };
  }

  if (session.profitLoss <= -config.maxSessionLoss) {
    return { allowed: false, reason: "Maximum session loss reached" };
  }

  if (session.consecutiveLosses >= config.maxConsecutiveLosses) {
    return { allowed: false, reason: "Maximum consecutive losses reached" };
  }

  if (
    session.lastLossAt !== null &&
    now - session.lastLossAt < config.cooldownAfterLossMs
  ) {
    return { allowed: false, reason: "Loss cooldown active" };
  }

  return { allowed: true, reason: "Trade allowed" };
}
