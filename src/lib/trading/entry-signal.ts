import { MIN_DIGIT_SAMPLE, type SpecialistFit } from "./specialist-edge";

export type EntryPhase =
  | "IDLE"
  | "WATCHING"
  | "SIGNAL"
  | "ARMED"
  | "PAPER_TRADE_OPEN"
  | "COOLDOWN";

export type EntryDecision = {
  phase: EntryPhase;
  armed: boolean;
  reason: string;
};

export function decideEntry(params: {
  enabled: boolean;
  open: boolean;
  riskAllowed: boolean;
  riskReason: string;
  minimumConfidence: number;
  fit: SpecialistFit | null;
}): EntryDecision {
  if (!params.enabled) {
    return { phase: "IDLE", armed: false, reason: "Specialist is not loaded" };
  }
  if (params.open) {
    return { phase: "PAPER_TRADE_OPEN", armed: false, reason: "Paper trade is already open" };
  }
  if (!params.riskAllowed) {
    return { phase: "COOLDOWN", armed: false, reason: params.riskReason };
  }
  if (!params.fit || params.fit.sampleSize < MIN_DIGIT_SAMPLE) {
    return {
      phase: "WATCHING",
      armed: false,
      reason: params.fit?.reason ?? "Insufficient sample",
    };
  }
  if (!params.fit.qualified) {
    return { phase: "WATCHING", armed: false, reason: params.fit.reason };
  }
  if (params.fit.probability < params.minimumConfidence) {
    return {
      phase: "SIGNAL",
      armed: false,
      reason: "Qualified signal is below the recovery confidence",
    };
  }
  return { phase: "ARMED", armed: true, reason: "Entry conditions are satisfied" };
}
