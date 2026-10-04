import type { FreeBotPreset, MasterRole } from "./bot-presets";
import type { EntryDecision, EntryPhase } from "./entry-signal";
import type { BotStrategy } from "./types";

export type ActiveMasterRole = MasterRole | "specialist";

export function resolveActiveMasterRole(
  preset: FreeBotPreset,
  selectedSpecialist?: BotStrategy,
): ActiveMasterRole {
  if (selectedSpecialist) {
    return "specialist";
  }
  if (preset.masterRole === "entry") {
    return "entry";
  }
  if (preset.masterRole === "router" || preset.master) {
    return "router";
  }
  return "specialist";
}

export function gateForMasterRole(
  role: ActiveMasterRole,
  decision: EntryDecision,
): EntryDecision {
  if (role !== "router") {
    return decision;
  }
  if (decision.phase === "ARMED" || decision.phase === "SIGNAL") {
    return {
      phase: "SIGNAL",
      armed: false,
      reason: "Router candidate is ready for Entry Signal Hunter. Entry is not armed.",
    };
  }
  return { ...decision, armed: false };
}

export function paperExecutionPermitted(
  role: ActiveMasterRole,
  phase: EntryPhase,
): boolean {
  return role !== "router" && phase === "ARMED";
}
