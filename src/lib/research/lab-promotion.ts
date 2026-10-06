import { LIVE_ORDERS_ENABLED } from "../trading/live-orders";
import type { LabMemory } from "./lab-store";
import { saveLabState, type LabPersistedState, type PromotedPaperConfig } from "./lab-store";
import { parameterDifferences, type LabVariant } from "./lab-variant";
import type { StrategyParameters } from "./strategy-spec";

export function promoteForPaper(params: {
  state: LabPersistedState;
  memory: LabMemory;
  variant: LabVariant;
  operational: StrategyParameters;
  confirmed: boolean;
}): { ok: true; config: PromotedPaperConfig; differences: string[] } | { ok: false; reason: string } {
  if (LIVE_ORDERS_ENABLED) {
    return { ok: false, reason: "Promotion is refused while live orders are enabled." };
  }
  if (!params.confirmed) {
    return { ok: false, reason: "Paper promotion requires an explicit confirmation." };
  }
  if (params.variant.researchStatus !== "VALIDATED_FOR_PAPER") {
    return {
      ok: false,
      reason: `Promotion requires VALIDATED_FOR_PAPER. Current status is ${params.variant.researchStatus}.`,
    };
  }
  const config: PromotedPaperConfig = {
    strategyId: params.variant.strategyId,
    version: params.variant.version,
    parameters: { ...params.variant.parameters },
    promotedAt: params.variant.createdAt,
    paperOnly: true,
    liveOrdersEnabled: false,
  };
  saveLabState(params.memory, { ...params.state, promoted: config });
  return {
    ok: true,
    config,
    differences: parameterDifferences(params.operational, params.variant.parameters),
  };
}
