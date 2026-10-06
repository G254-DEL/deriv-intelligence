import { MIN_DIGIT_SAMPLE, MIN_EDGE } from "../trading/specialist-edge";
import {
  parametersOf,
  type StrategyDefinition,
  type StrategyParameters,
} from "./strategy-spec";

export const LAB_PARAMETER_LIMITS = Object.freeze({
  minimumSampleSize: { min: MIN_DIGIT_SAMPLE, max: 200 },
  sampleWindow: { min: MIN_DIGIT_SAMPLE, max: 200 },
  minimumEdge: { min: 0, max: 0.5 },
  minimumConfidence: { min: 0, max: 1 },
  signalPersistence: { min: 1, max: 5 },
  cooldownTicks: { min: 0, max: 20 },
  cooldownAfterLossMs: { min: 0, max: 60_000 },
});

export type LabResearchStatus =
  | "DRAFT"
  | "TESTING"
  | "INSUFFICIENT_DATA"
  | "VALIDATED_FOR_PAPER"
  | "REJECTED";

export type LabVariant = {
  id: string;
  name: string;
  strategyId: string;
  strategyVersion: number;
  botStrategy: StrategyDefinition["botStrategy"];
  contractType: string;
  barrier: number | null;
  description: string;
  enabled: boolean;
  version: number;
  parameters: StrategyParameters;
  researchStatus: LabResearchStatus;
  createdAt: number;
};

export function operationalVariant(
  definition: StrategyDefinition,
  now = 0,
): LabVariant {
  return {
    id: `${definition.strategyId}:current`,
    name: `${definition.name} — Current`,
    strategyId: definition.strategyId,
    strategyVersion: definition.strategyVersion,
    botStrategy: definition.botStrategy,
    contractType: definition.contractType,
    barrier: definition.barrier,
    description: definition.hypothesis,
    enabled: definition.status === "ACTIVE",
    version: definition.strategyVersion,
    parameters: parametersOf(definition),
    researchStatus: "DRAFT",
    createdAt: now,
  };
}

export function validateLabParameters(
  parameters: StrategyParameters,
): string[] {
  const errors: string[] = [];
  const limits = LAB_PARAMETER_LIMITS;
  if (!integerIn(parameters.minimumSampleSize, limits.minimumSampleSize)) {
    errors.push(
      `Minimum sample must be an integer from ${limits.minimumSampleSize.min} to ${limits.minimumSampleSize.max}.`,
    );
  }
  if (!integerIn(parameters.sampleWindow, limits.sampleWindow)) {
    errors.push(
      `Sample window must be an integer from ${limits.sampleWindow.min} to ${limits.sampleWindow.max}.`,
    );
  }
  if (
    integerIn(parameters.minimumSampleSize, limits.minimumSampleSize) &&
    integerIn(parameters.sampleWindow, limits.sampleWindow) &&
    parameters.sampleWindow < parameters.minimumSampleSize
  ) {
    errors.push("Sample window cannot be smaller than the minimum sample.");
  }
  if (!numberIn(parameters.minimumEdge, limits.minimumEdge)) {
    errors.push(
      `Minimum edge must be from ${limits.minimumEdge.min} to ${limits.minimumEdge.max}.`,
    );
  }
  if (!numberIn(parameters.minimumConfidence, limits.minimumConfidence)) {
    errors.push("Minimum confidence must be from 0 to 1.");
  }
  if (!integerIn(parameters.signalPersistence, limits.signalPersistence)) {
    errors.push("Signal persistence must be an integer from 1 to 5.");
  }
  if (!integerIn(parameters.cooldownTicks, limits.cooldownTicks)) {
    errors.push("Cooldown ticks must be an integer from 0 to 20.");
  }
  if (!integerIn(parameters.cooldownAfterLossMs, limits.cooldownAfterLossMs)) {
    errors.push("Loss cooldown must be from 0 to 60000 milliseconds.");
  }
  if (!Number.isFinite(parameters.stake) || parameters.stake <= 0) {
    errors.push("Stake must stay a positive paper stake.");
  }
  return errors;
}

export function createLabVariant(params: {
  definition: StrategyDefinition;
  name: string;
  overrides: Partial<StrategyParameters>;
  now?: number;
  version?: number;
}): { ok: true; variant: LabVariant } | { ok: false; errors: string[] } {
  const name = params.name.trim();
  if (name.length < 3 || name.length > 60) {
    return { ok: false, errors: ["Variant name must be 3 to 60 characters."] };
  }
  const parameters = parametersOf(params.definition, {
    ...params.overrides,
    stake: params.definition.parameters.stake,
  });
  const errors = validateLabParameters(parameters);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const version = params.version ?? 1;
  return {
    ok: true,
    variant: {
      id: `${params.definition.strategyId}:v${version}:${params.now ?? 0}`,
      name,
      strategyId: params.definition.strategyId,
      strategyVersion: params.definition.strategyVersion,
      botStrategy: params.definition.botStrategy,
      contractType: params.definition.contractType,
      barrier: params.definition.barrier,
      description: `${params.definition.name} lab variant. Operational thresholds stay at sample ${MIN_DIGIT_SAMPLE} and edge ${MIN_EDGE} until an explicit paper promotion.`,
      enabled: true,
      version,
      parameters,
      researchStatus: "DRAFT",
      createdAt: params.now ?? 0,
    },
  };
}

export function parameterDifferences(
  operational: StrategyParameters,
  variant: StrategyParameters,
): string[] {
  const lines: string[] = [];
  const keys: Array<keyof StrategyParameters> = [
    "sampleWindow",
    "minimumSampleSize",
    "minimumEdge",
    "minimumConfidence",
    "signalPersistence",
    "cooldownAfterLossMs",
    "cooldownTicks",
    "stake",
  ];
  for (const key of keys) {
    if (operational[key] !== variant[key]) {
      lines.push(`${key}: ${operational[key]} -> ${variant[key]}`);
    }
  }
  return lines;
}

function integerIn(value: number, bounds: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

function numberIn(value: number, bounds: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}
