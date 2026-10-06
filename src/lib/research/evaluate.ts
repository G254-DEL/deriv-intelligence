import { decideEntry, type EntryDecision } from "../trading/entry-signal";
import { getRecoveryDecision } from "../trading/recovery";
import type { TradingSession } from "../trading/session";
import {
  fitForStrategy,
  type EdgeThresholds,
  type SpecialistFit,
} from "../trading/specialist-edge";
import type { BotStrategy } from "../trading/types";

export type CausalDecision = EntryDecision & {
  fit: SpecialistFit | null;
};

export function evaluateCausalSample(params: {
  digits: number[];
  strategy: BotStrategy;
  thresholds: EdgeThresholds;
  session: TradingSession;
  confidenceFloor: number;
  open: boolean;
  riskAllowed: boolean;
  riskReason: string;
  enabled?: boolean;
  signalPersistenceMet: boolean;
  avoidedByPerformance: boolean;
  tickCooldownActive: boolean;
}): CausalDecision {
  const fit = fitForStrategy(params.digits, params.strategy, params.thresholds);
  const minimumConfidence = Math.max(
    params.confidenceFloor,
    getRecoveryDecision(params.session).minimumConfidence,
  );
  let decision = decideEntry({
    enabled: params.enabled ?? true,
    open: params.open,
    riskAllowed: params.riskAllowed,
    riskReason: params.riskReason,
    minimumConfidence,
    fit,
  });
  if (decision.phase === "ARMED" && !params.signalPersistenceMet) {
    decision = {
      phase: "SIGNAL",
      armed: false,
      reason: "Qualified sample has not met the persistence count",
    };
  }
  if (decision.armed && params.tickCooldownActive) {
    decision = { phase: "COOLDOWN", armed: false, reason: "Tick cooldown active" };
  }
  if (decision.armed && params.avoidedByPerformance) {
    decision = {
      phase: "WATCHING",
      armed: false,
      reason: "Performance memory is avoiding this pair",
    };
  }
  return { ...decision, fit };
}
