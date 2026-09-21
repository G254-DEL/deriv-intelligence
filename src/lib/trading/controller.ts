import type { BotStrategy, PaperTrade } from "./types";
import type { TradingSession } from "./session";
import type { RiskConfig } from "./risk";

import { canPlaceTrade, DEFAULT_RISK_CONFIG } from "./risk";
import { getRecoveryDecision, calculateRecoveryStake } from "./recovery";
import { createPaperTrade, settlePaperTrade } from "./paper-engine";
import { recordPaperTrade } from "./session";
import { strategyWins } from "./strategy-rules";

export type PaperTradeSignal = {
  strategy: BotStrategy;
  symbol: string;
  contractType: string;
  barrier?: number;
  entryDigit: number;
  confidence: number;
  payoutRatio: number;
  targetProfit?: number;
  evenOddSide?: "EVEN" | "ODD";
};

export type OpenTradeResult = {
  allowed: boolean;
  reason: string;
  trade?: PaperTrade;
};

export function openControlledPaperTrade(
  session: TradingSession,
  signal: PaperTradeSignal,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): OpenTradeResult {
  const risk = canPlaceTrade(session, config);

  if (!risk.allowed) {
    return { allowed: false, reason: risk.reason };
  }

  const recovery = getRecoveryDecision(session);

  if (!recovery.allowed) {
    return { allowed: false, reason: recovery.reason };
  }

  if (signal.confidence < recovery.minimumConfidence) {
    return {
      allowed: false,
      reason: `Signal confidence below required ${recovery.minimumConfidence}`,
    };
  }

  const accumulatedLoss = Math.max(0, -session.profitLoss);

  const recoveryStake = calculateRecoveryStake({
    accumulatedLoss,
    targetProfit: signal.targetProfit ?? 0,
    payoutRatio: signal.payoutRatio,
    baseStake: config.stake,
    maxStake: config.maxStake,
  });

  if (!recoveryStake.allowed) {
    return { allowed: false, reason: recoveryStake.reason };
  }

  const trade = createPaperTrade({
    strategy: signal.strategy,
    symbol: signal.symbol,
    contractType: signal.contractType,
    barrier: signal.barrier,
    stake: recovery.recoveryMode ? recoveryStake.stake : config.stake,
    entryDigit: signal.entryDigit,
  });

  return {
    allowed: true,
    reason: recovery.recoveryMode ? recoveryStake.reason : "Paper trade opened",
    trade,
  };
}

export function closeControlledPaperTrade(
  session: TradingSession,
  trade: PaperTrade,
  exitDigit: number,
  payout: number,
  evenOddSide: "EVEN" | "ODD" = "EVEN",
): { trade: PaperTrade; session: TradingSession } {
  const won = strategyWins(trade.strategy, exitDigit, evenOddSide);

  const settledTrade = settlePaperTrade(
    trade,
    exitDigit,
    won,
    payout,
  );

  return {
    trade: settledTrade,
    session: recordPaperTrade(session, settledTrade),
  };
}
