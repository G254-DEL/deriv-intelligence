import type { BotStrategy } from "../trading/types";

export const REAL_DATA_REQUIRED = "REAL HISTORICAL VALIDATION DATA REQUIRED";

export type RegistryStatus = "ACTIVE" | "EXPERIMENTAL" | "DISABLED";

export type StrategyParameters = {
  sampleWindow: number;
  minimumSampleSize: number;
  minimumEdge: number;
  minimumConfidence: number;
  signalPersistence: number;
  cooldownAfterLossMs: number;
  cooldownTicks: number;
  stake: number;
};

export type StrategyDefinition = {
  strategyId: string;
  strategyVersion: number;
  botStrategy: BotStrategy;
  name: string;
  status: RegistryStatus;
  hypothesis: string;
  contractType: string;
  alternateContractTypes: readonly string[];
  barrier: number | null;
  baselineProbability: number;
  baselineExplanation: string;
  predictionModel: "observed-window-frequency";
  parameters: StrategyParameters;
  featureIds: readonly string[];
  entryRules: readonly string[];
  rejectionRules: readonly string[];
  settlement: {
    durationTicks: 1;
    winRule: string;
    profitRule: string;
  };
  routerPersistence: {
    usedAsEntryGate: false;
    usedInRank: true;
    trailingCap: number;
    rankWeight: number;
  };
  performanceMemory: {
    changesProbability: false;
    changesStake: false;
    changesQualification: false;
    avoidAfterConsecutiveLosses: number;
    maxRankBonus: number;
    maxRankPenalty: number;
  };
  proposal: {
    requiredToOpenPaper: true;
    liveEconomicGate: false;
    note: string;
  };
};

export type OrchestrationDefinition = {
  strategyId: "market-router" | "entry-signal-hunter";
  strategyVersion: number;
  name: string;
  status: RegistryStatus;
  role: "router" | "entry";
  executes: false;
  rules: readonly string[];
};

const FEATURE_IDS = [
  "digit-frequency",
  "barrier-frequency",
  "parity-frequency",
  "streak",
  "transition-matrix",
  "baseline-distance",
  "short-long-divergence",
  "rolling-entropy",
  "distribution-imbalance",
  "regime-change",
] as const;

const SHARED_ENTRY = [
  "Sample is the last sampleWindow valid digits. Live storage keeps 20.",
  "Probability is the observed winning-digit frequency in that sample.",
  "Baseline is the digit-rule probability and is not the observed frequency.",
  "Edge is probability minus baseline.",
  "Qualified when sampleSize >= 10 and edge >= 0.08.",
  "IDLE when the specialist is not loaded.",
  "PAPER_TRADE_OPEN when that symbol already has a paper position.",
  "COOLDOWN when risk blocks, including the 5000ms loss cooldown.",
  "WATCHING when the sample is short or the edge is below 0.08.",
  "SIGNAL when qualified but probability is below the recovery confidence floor.",
  "ARMED when qualified and probability meets that floor.",
  "Entry persistence is 1: the current sample is sufficient. Router trailing persistence only changes rank.",
  "Recovery confidence floor is 0, then 0.7 after one loss, then 0.8 after two. Stake stays at the base stake.",
  "Two consecutive paper losses make the router avoid that symbol and strategy. They do not change the probability.",
] as const;

const SHARED_REJECTION = [
  "Sample under 10.",
  "Edge under 0.08.",
  "Open paper position on the symbol.",
  "Risk cooldown, session loss, consecutive-loss cap, or trade cap.",
  "Router role never arms execution.",
  "Unknown or unsupported digit contract is not router-ready.",
  "Invalid, expired, or unidentified proposal opens nothing.",
  "Duplicate open position, proposal id, or signal key is rejected.",
] as const;

function specialist(params: {
  strategyId: string;
  botStrategy: BotStrategy;
  name: string;
  hypothesis: string;
  contractType: string;
  alternateContractTypes?: readonly string[];
  barrier: number | null;
  baselineProbability: number;
  baselineExplanation: string;
  winRule: string;
}): StrategyDefinition {
  return deepFreeze({
    strategyId: params.strategyId,
    strategyVersion: 1,
    botStrategy: params.botStrategy,
    name: params.name,
    status: "ACTIVE",
    hypothesis: params.hypothesis,
    contractType: params.contractType,
    alternateContractTypes: params.alternateContractTypes ?? [],
    barrier: params.barrier,
    baselineProbability: params.baselineProbability,
    baselineExplanation: params.baselineExplanation,
    predictionModel: "observed-window-frequency",
    parameters: {
      sampleWindow: 20,
      minimumSampleSize: 10,
      minimumEdge: 0.08,
      minimumConfidence: 0,
      signalPersistence: 1,
      cooldownAfterLossMs: 5000,
      cooldownTicks: 0,
      stake: 1,
    },
    featureIds: FEATURE_IDS,
    entryRules: SHARED_ENTRY,
    rejectionRules: SHARED_REJECTION,
    settlement: {
      durationTicks: 1,
      winRule: params.winRule,
      profitRule: "Win pays the proposal payout minus ask price. Loss costs the ask price. Stake is not increased after a loss.",
    },
    routerPersistence: {
      usedAsEntryGate: false,
      usedInRank: true,
      trailingCap: 5,
      rankWeight: 0.1,
    },
    performanceMemory: {
      changesProbability: false,
      changesStake: false,
      changesQualification: false,
      avoidAfterConsecutiveLosses: 2,
      maxRankBonus: 0.1,
      maxRankPenalty: 0.15,
    },
    proposal: {
      requiredToOpenPaper: true,
      liveEconomicGate: false,
      note: "Live paper still requires a validated proposal, but it does not yet block on break-even. Research classification keeps statistical edge and economic edge separate.",
    },
  });
}

export const STRATEGY_DEFINITIONS: readonly StrategyDefinition[] = deepFreeze([
  specialist({
    strategyId: "under-7-hunter",
    botStrategy: "UNDER_7",
    name: "Under 7 Hunter",
    hypothesis:
      "Determine whether observable recent digit-state features contain predictive information about P(next digit < 7) beyond the appropriate baseline.",
    contractType: "DIGITUNDER",
    barrier: 7,
    baselineProbability: 0.7,
    baselineExplanation: "Winning digits 0-6. Baseline = 7/10.",
    winRule: "Next last digit is strictly less than 7.",
  }),
  specialist({
    strategyId: "under-8-hunter",
    botStrategy: "UNDER_8",
    name: "Under 8 Hunter",
    hypothesis:
      "Determine whether observable features predict P(next digit < 8) beyond baseline.",
    contractType: "DIGITUNDER",
    barrier: 8,
    baselineProbability: 0.8,
    baselineExplanation: "Winning digits 0-7. Baseline = 8/10.",
    winRule: "Next last digit is strictly less than 8.",
  }),
  specialist({
    strategyId: "over-2-hunter",
    botStrategy: "OVER_2",
    name: "Over 2 Hunter",
    hypothesis:
      "Determine whether observable features predict P(next digit > 2) beyond baseline.",
    contractType: "DIGITOVER",
    barrier: 2,
    baselineProbability: 0.7,
    baselineExplanation: "Winning digits 3-9. Baseline = 7/10.",
    winRule: "Next last digit is strictly greater than 2.",
  }),
  specialist({
    strategyId: "over-3-hunter",
    botStrategy: "OVER_3",
    name: "Over 3 Hunter",
    hypothesis:
      "Determine whether observable features predict P(next digit > 3) beyond baseline.",
    contractType: "DIGITOVER",
    barrier: 3,
    baselineProbability: 0.6,
    baselineExplanation: "Winning digits 4-9. Baseline = 6/10.",
    winRule: "Next last digit is strictly greater than 3.",
  }),
  specialist({
    strategyId: "even-odd-hunter",
    botStrategy: "EVEN_ODD",
    name: "Even/Odd Hunter",
    hypothesis:
      "Determine whether observable features predict the next digit parity beyond its baseline.",
    contractType: "PARITY",
    alternateContractTypes: ["DIGITEVEN", "DIGITODD"],
    barrier: null,
    baselineProbability: 0.5,
    baselineExplanation: "Even digits 0,2,4,6,8 and odd digits 1,3,5,7,9. Each baseline = 5/10.",
    winRule: "Next last digit matches the side selected at decision time.",
  }),
]);

export const ORCHESTRATION_DEFINITIONS: readonly OrchestrationDefinition[] = deepFreeze([
  {
    strategyId: "market-router",
    strategyVersion: 1,
    name: "Market Router",
    status: "ACTIVE",
    role: "router",
    executes: false,
    rules: [
      "Evaluates every ACTIVE specialist on each eligible synthetic.",
      "A pair is router-ready only when the specialist qualifies, the digit contract is listed, the symbol is not excluded, and performance memory is not avoiding it.",
      "Rank score is 0.7*edge + 0.15*sample sufficiency + 0.1*trailing persistence + performance adjustment.",
      "Assigns the strongest ready specialist on a symbol, then one primary symbol per specialist.",
      "Does not arm and does not open a paper trade.",
    ],
  },
  {
    strategyId: "entry-signal-hunter",
    strategyVersion: 1,
    name: "Entry Signal Hunter",
    status: "ACTIVE",
    role: "entry",
    executes: false,
    rules: [
      "Runs decideEntry on the assigned specialist sample.",
      "WATCHING is the wait state.",
      "SIGNAL is qualified but below the recovery confidence floor, and is not executable.",
      "ARMED is the only phase that can open a paper trade, and only when runtime entries are allowed and live orders are off.",
      "Cannot be bypassed by the router.",
    ],
  },
]);

export function parametersOf(
  definition: StrategyDefinition,
  override?: Partial<StrategyParameters>,
): StrategyParameters {
  return {
    ...definition.parameters,
    ...override,
    stake: definition.parameters.stake,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
