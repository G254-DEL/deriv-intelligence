import type { NormalizedTick } from "./dataset";
import type { ContractPerformance } from "./lab-replay";
import type { LabResearchStatus, LabVariant } from "./lab-variant";

export const LAB_STORAGE_KEY = "deriv-intelligence.strategy-lab.v1";
export const MAX_LAB_OBSERVATIONS = 2_000;
export const MAX_LAB_EXPERIMENTS = 20;
export const MAX_LAB_VARIANTS = 12;

export const LAB_STORAGE_NOTE =
  "Observations and experiments stay in this browser session only. They are not a Deriv history download, and they disappear when the session ends.";

export type LabObservation = {
  symbol: string;
  epoch: number;
  quote: number;
  lastDigit: number;
};

export type LabExperiment = {
  id: string;
  strategyId: string;
  version: number;
  market: string;
  parameters: LabVariant["parameters"];
  fromEpoch: number | null;
  toEpoch: number | null;
  sampleSize: number;
  performance: ContractPerformance;
  validationStatus: LabResearchStatus;
  timestamp: number;
};

export type PromotedPaperConfig = {
  strategyId: string;
  version: number;
  parameters: LabVariant["parameters"];
  promotedAt: number;
  paperOnly: true;
  liveOrdersEnabled: false;
};

export type LabPersistedState = {
  variants: LabVariant[];
  observations: LabObservation[];
  experiments: LabExperiment[];
  promoted: PromotedPaperConfig | null;
};

export type LabMemory = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

export function emptyLabState(): LabPersistedState {
  return { variants: [], observations: [], experiments: [], promoted: null };
}

export function sessionLabStore(): LabMemory {
  return {
    get: (key) => {
      if (typeof sessionStorage === "undefined") {
        return null;
      }
      return sessionStorage.getItem(key);
    },
    set: (key, value) => {
      if (typeof sessionStorage === "undefined") {
        return;
      }
      sessionStorage.setItem(key, value);
    },
  };
}

export function memoryLabStore(initial = new Map<string, string>()): LabMemory {
  return {
    get: (key) => initial.get(key) ?? null,
    set: (key, value) => {
      initial.set(key, value);
    },
  };
}

export function loadLabState(memory: LabMemory): LabPersistedState {
  const raw = memory.get(LAB_STORAGE_KEY);
  if (!raw) {
    return emptyLabState();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LabPersistedState>;
    return boundState({
      variants: Array.isArray(parsed.variants) ? parsed.variants : [],
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      experiments: Array.isArray(parsed.experiments) ? parsed.experiments : [],
      promoted: parsed.promoted ?? null,
    });
  } catch {
    return emptyLabState();
  }
}

export function saveLabState(memory: LabMemory, state: LabPersistedState): LabPersistedState {
  const bounded = boundState(state);
  memory.set(LAB_STORAGE_KEY, JSON.stringify(bounded));
  return bounded;
}

export function appendObservation(
  state: LabPersistedState,
  observation: LabObservation,
): LabPersistedState {
  if (
    !Number.isInteger(observation.lastDigit) ||
    observation.lastDigit < 0 ||
    observation.lastDigit > 9 ||
    !Number.isFinite(observation.quote) ||
    !Number.isFinite(observation.epoch)
  ) {
    return state;
  }
  const duplicate = state.observations.some(
    (item) => item.symbol === observation.symbol && item.epoch === observation.epoch,
  );
  if (duplicate) {
    return state;
  }
  return boundState({
    ...state,
    observations: [...state.observations, observation],
  });
}

export function addVariant(state: LabPersistedState, variant: LabVariant): LabPersistedState {
  const without = state.variants.filter((item) => item.id !== variant.id);
  return boundState({ ...state, variants: [...without, variant] });
}

export function addExperiment(
  state: LabPersistedState,
  experiment: LabExperiment,
): LabPersistedState {
  return boundState({ ...state, experiments: [...state.experiments, experiment] });
}

export function observationsToTicks(observations: readonly LabObservation[]): NormalizedTick[] {
  return observations.map((observation) => ({
    symbol: observation.symbol,
    epoch: observation.epoch,
    quote: observation.quote,
    lastDigit: observation.lastDigit,
  }));
}

function boundState(state: LabPersistedState): LabPersistedState {
  return {
    variants: state.variants.slice(-MAX_LAB_VARIANTS),
    observations: state.observations.slice(-MAX_LAB_OBSERVATIONS),
    experiments: state.experiments.slice(-MAX_LAB_EXPERIMENTS),
    promoted: state.promoted,
  };
}
