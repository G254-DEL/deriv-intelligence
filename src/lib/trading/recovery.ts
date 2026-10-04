import type { TradingSession } from "./session";

export type RecoveryDecision = {
  recoveryMode: boolean;
  allowed: boolean;
  stakeMultiplier: number;
  minimumConfidence: number;
  shouldRescan: boolean;
  reason: string;
};

export function getRecoveryDecision(
  session: TradingSession,
): RecoveryDecision {
  if (session.consecutiveLosses === 0) {
    return {
      recoveryMode: false,
      allowed: true,
      stakeMultiplier: 1,
      minimumConfidence: 0,
      shouldRescan: false,
      reason: "Normal trading mode",
    };
  }

  if (session.consecutiveLosses === 1) {
    return {
      recoveryMode: true,
      allowed: true,
      stakeMultiplier: 1,
      minimumConfidence: 0.7,
      shouldRescan: true,
      reason: "One loss: rescan markets and require stronger signal",
    };
  }

  return {
    recoveryMode: true,
    allowed: true,
    stakeMultiplier: 1,
    minimumConfidence: 0.8,
    shouldRescan: true,
    reason: "Two consecutive losses: switch market and seek a stronger recovery signal",
  };
}

export type RecoveryStakeResult = {
  stake: number;
  allowed: boolean;
  reason: string;
};

export function calculateRecoveryStake(params: {
  accumulatedLoss: number;
  targetProfit: number;
  payoutRatio: number;
  baseStake: number;
}): RecoveryStakeResult {
  const {
    accumulatedLoss,
    targetProfit,
    payoutRatio,
    baseStake,
  } = params;

  if (payoutRatio <= 0 || baseStake <= 0) {
    return {
      stake: 0,
      allowed: false,
      reason: "Invalid recovery parameters",
    };
  }

  void accumulatedLoss;
  void targetProfit;
  return {
    stake: baseStake,
    allowed: true,
    reason: "Base stake",
  };
}




