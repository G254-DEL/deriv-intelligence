import { buildDigitDistribution, type DigitDistribution } from "../strategy/digit-distribution";
import { evaluateCausalSample } from "./evaluate";
import type { StrategyDefinition, StrategyParameters } from "./strategy-spec";
import { createTradingSession } from "../trading/session";

export type LabMonitorState =
  | "INSUFFICIENT_DATA"
  | "WATCHING"
  | "SIGNAL"
  | "ARMED"
  | "COOLDOWN"
  | "REJECTED";

export type LabCheck = {
  label: string;
  passed: boolean;
  detail: string;
};

export type LabEvaluation = {
  state: LabMonitorState;
  reason: string;
  qualified: boolean;
  observedProbability: number | null;
  baselineProbability: number;
  edge: number | null;
  confidence: number | null;
  sampleSize: number;
  contractType: string;
  barrier: number | null;
  evenOddSide?: "EVEN" | "ODD";
  watches: string;
  distribution: DigitDistribution;
  checks: LabCheck[];
  ordersPlaced: false;
};

export function evaluateLabMonitor(params: {
  digits: number[];
  definition: StrategyDefinition;
  parameters: StrategyParameters;
  enabled?: boolean;
  tickCooldownActive?: boolean;
}): LabEvaluation {
  const windowed = params.digits.slice(-params.parameters.sampleWindow);
  const distribution = buildDigitDistribution(windowed);
  const enabled = params.enabled ?? true;
  const baseline = params.definition.baselineProbability;
  const watches = params.definition.baselineExplanation;

  if (!enabled) {
    return evaluation({
      state: "REJECTED",
      reason: "This lab variant is disabled.",
      qualified: false,
      observedProbability: null,
      baseline,
      edge: null,
      confidence: null,
      sampleSize: distribution.sampleSize,
      definition: params.definition,
      distribution,
      watches,
      checks: [
        { label: "Enabled", passed: false, detail: "Variant is disabled." },
      ],
    });
  }

  if (distribution.sampleSize < params.parameters.minimumSampleSize) {
    return evaluation({
      state: "INSUFFICIENT_DATA",
      reason: `Need ${params.parameters.minimumSampleSize} digits. Current sample is ${distribution.sampleSize}.`,
      qualified: false,
      observedProbability: null,
      baseline,
      edge: null,
      confidence: null,
      sampleSize: distribution.sampleSize,
      definition: params.definition,
      distribution,
      watches,
      checks: sampleChecks(
        params.parameters,
        distribution.sampleSize,
        null,
        null,
        !params.tickCooldownActive,
      ),
    });
  }

  const decision = evaluateCausalSample({
    digits: windowed,
    strategy: params.definition.botStrategy,
    thresholds: {
      minimumSampleSize: params.parameters.minimumSampleSize,
      minimumEdge: params.parameters.minimumEdge,
    },
    session: createTradingSession(),
    confidenceFloor: params.parameters.minimumConfidence,
    open: false,
    riskAllowed: !params.tickCooldownActive,
    riskReason: params.tickCooldownActive ? "Tick cooldown active" : "Trade allowed",
    enabled: true,
    signalPersistenceMet: true,
    avoidedByPerformance: false,
    tickCooldownActive: Boolean(params.tickCooldownActive),
  });
  const fit = decision.fit;
  const observed = fit?.probability ?? null;
  const edge = fit?.edge ?? null;
  const checks = sampleChecks(
    params.parameters,
    distribution.sampleSize,
    observed,
    edge,
    !params.tickCooldownActive,
  );
  const state = mapState(decision.phase, distribution.sampleSize, params.parameters.minimumSampleSize);

  return evaluation({
    state,
    reason: state === "ARMED" ? qualifiedReason(fit) : decision.reason,
    qualified: Boolean(fit?.qualified) && state === "ARMED",
    observedProbability: observed,
    baseline,
    edge,
    confidence: observed,
    sampleSize: fit?.sampleSize ?? distribution.sampleSize,
    definition: params.definition,
    distribution,
    watches,
    checks,
    contractType: fit?.contractType,
    barrier: fit?.barrier ?? params.definition.barrier,
    evenOddSide: fit?.evenOddSide,
  });
}

function evaluation(params: {
  state: LabMonitorState;
  reason: string;
  qualified: boolean;
  observedProbability: number | null;
  baseline: number;
  edge: number | null;
  confidence: number | null;
  sampleSize: number;
  definition: StrategyDefinition;
  distribution: DigitDistribution;
  watches: string;
  checks: LabCheck[];
  contractType?: string;
  barrier?: number | null;
  evenOddSide?: "EVEN" | "ODD";
}): LabEvaluation {
  return {
    state: params.state,
    reason: params.reason,
    qualified: params.qualified,
    observedProbability: params.observedProbability,
    baselineProbability: params.baseline,
    edge: params.edge,
    confidence: params.confidence,
    sampleSize: params.sampleSize,
    contractType: params.contractType ?? params.definition.contractType,
    barrier: params.barrier === undefined ? params.definition.barrier : params.barrier,
    evenOddSide: params.evenOddSide,
    watches: params.watches,
    distribution: params.distribution,
    checks: params.checks,
    ordersPlaced: false,
  };
}

function sampleChecks(
  parameters: StrategyParameters,
  sampleSize: number,
  observed: number | null,
  edge: number | null,
  cooldownClear: boolean,
): LabCheck[] {
  return [
    {
      label: "Sample size",
      passed: sampleSize >= parameters.minimumSampleSize,
      detail: `${sampleSize} of ${parameters.minimumSampleSize} required digits`,
    },
    {
      label: "Edge",
      passed: edge !== null && edge >= parameters.minimumEdge,
      detail:
        edge === null
          ? "Edge is not available yet"
          : `Edge ${edge.toFixed(3)} versus minimum ${parameters.minimumEdge}`,
    },
    {
      label: "Confidence",
      passed: observed !== null && observed >= parameters.minimumConfidence,
      detail:
        observed === null
          ? "Observed probability is not available yet"
          : `Observed ${observed.toFixed(3)} versus floor ${parameters.minimumConfidence}`,
    },
    {
      label: "Cooldown",
      passed: cooldownClear,
      detail: cooldownClear ? "No tick cooldown is active" : "Tick cooldown is active",
    },
  ];
}

function mapState(
  phase: string,
  sampleSize: number,
  minimumSampleSize: number,
): LabMonitorState {
  if (sampleSize < minimumSampleSize) {
    return "INSUFFICIENT_DATA";
  }
  switch (phase) {
    case "ARMED":
      return "ARMED";
    case "SIGNAL":
      return "SIGNAL";
    case "COOLDOWN":
      return "COOLDOWN";
    case "IDLE":
      return "REJECTED";
    default:
      return "WATCHING";
  }
}

function qualifiedReason(fit: { probability: number; edge: number; sampleSize: number; reason: string } | null): string {
  if (!fit) {
    return "Entry conditions are not available.";
  }
  return `Qualified: sample ${fit.sampleSize}, observed ${(fit.probability * 100).toFixed(1)}%, edge ${fit.edge.toFixed(3)}. ${fit.reason}`;
}
