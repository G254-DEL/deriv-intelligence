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
    allowed: false,
    stakeMultiplier: 1,
    minimumConfidence: 0.8,
    shouldRescan: true,
    reason: "Two consecutive losses: stop new trades and rescan",
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
  maxStake: number;
}): RecoveryStakeResult {
  const {
    accumulatedLoss,
    targetProfit,
    payoutRatio,
    baseStake,
    maxStake,
  } = params;

  if (payoutRatio <= 0 || baseStake <= 0 || maxStake <= 0) {
    return {
      stake: 0,
      allowed: false,
      reason: "Invalid recovery parameters",
    };
  }

  const amountToRecover = Math.max(0, accumulatedLoss) + Math.max(0, targetProfit);

  const requiredStake =
    amountToRecover > 0
      ? amountToRecover / payoutRatio
      : baseStake;

  const stake = Math.max(
    baseStake,
    Math.ceil(requiredStake * 100) / 100,
  );

  if (stake > maxStake) {
    return {
      stake,
      allowed: false,
      reason: "Required recovery stake exceeds maximum stake",
    };
  }

  return {
    stake,
    allowed: true,
    reason: amountToRecover > 0
      ? "Recovery stake calculated from payout"
      : "Base stake",
  };
}
