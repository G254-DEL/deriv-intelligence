import type { BotStrategy } from "../trading/types";
import {
  ORCHESTRATION_DEFINITIONS,
  STRATEGY_DEFINITIONS,
  type OrchestrationDefinition,
  type RegistryStatus,
  type StrategyDefinition,
} from "./strategy-spec";

export function listStrategies(): readonly StrategyDefinition[] {
  return STRATEGY_DEFINITIONS;
}

export function listOrchestration(): readonly OrchestrationDefinition[] {
  return ORCHESTRATION_DEFINITIONS;
}

export function getStrategy(
  strategyId: string,
  strategyVersion = 1,
): StrategyDefinition | null {
  return (
    STRATEGY_DEFINITIONS.find(
      (definition) =>
        definition.strategyId === strategyId &&
        definition.strategyVersion === strategyVersion,
    ) ?? null
  );
}

export function definitionForBotStrategy(strategy: BotStrategy): StrategyDefinition {
  const found = STRATEGY_DEFINITIONS.find(
    (definition) => definition.botStrategy === strategy && definition.status === "ACTIVE",
  );
  if (!found) {
    throw new Error(`No ACTIVE strategy definition for ${strategy}`);
  }
  return found;
}

export function activeBotStrategies(): Set<BotStrategy> {
  return new Set(
    STRATEGY_DEFINITIONS.filter((definition) => definition.status === "ACTIVE").map(
      (definition) => definition.botStrategy,
    ),
  );
}

export function routerEligibleStrategies(
  definitions: readonly { botStrategy?: BotStrategy; status: RegistryStatus }[],
): BotStrategy[] {
  return definitions.flatMap((definition) =>
    definition.status === "ACTIVE" && definition.botStrategy
      ? [definition.botStrategy]
      : [],
  );
}
