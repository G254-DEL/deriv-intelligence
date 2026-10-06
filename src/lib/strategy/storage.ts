import {
  STRATEGY_TYPES,
  type SavedStrategy,
  type StrategyType,
} from "./saved-strategy";
import { DEFAULT_RISK_CONFIG, type RiskConfig } from "@/src/lib/trading/risk";

export const STRATEGIES_STORAGE_KEY = "deriv-intelligence.strategies.v1";

export function loadSavedStrategies(): SavedStrategy[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STRATEGIES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(parseSavedStrategy)
      .filter((item): item is SavedStrategy => item !== null);
  } catch {
    return [];
  }
}

export function persistSavedStrategies(strategies: SavedStrategy[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    STRATEGIES_STORAGE_KEY,
    JSON.stringify(strategies),
  );
}

const EMPTY_STRATEGIES: SavedStrategy[] = [];
let cachedStrategies: SavedStrategy[] | null = null;
let afterHydrationRead = false;
const strategyListeners = new Set<() => void>();

export function getSavedStrategiesSnapshot(): SavedStrategy[] {
  if (!afterHydrationRead) {
    return EMPTY_STRATEGIES;
  }

  if (cachedStrategies === null) {
    cachedStrategies = loadSavedStrategies();
  }
  return cachedStrategies;
}

export function getSavedStrategiesServerSnapshot(): SavedStrategy[] {
  return EMPTY_STRATEGIES;
}

export function subscribeSavedStrategies(onStoreChange: () => void): () => void {
  if (!afterHydrationRead) {
    afterHydrationRead = true;
    cachedStrategies = loadSavedStrategies();
  }

  strategyListeners.add(onStoreChange);
  return () => {
    strategyListeners.delete(onStoreChange);
  };
}

export function writeSavedStrategies(strategies: SavedStrategy[]): void {
  afterHydrationRead = true;
  cachedStrategies = strategies;
  persistSavedStrategies(strategies);
  strategyListeners.forEach((listener) => listener());
}

function parseSavedStrategy(value: unknown): SavedStrategy | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  const market = readString(value.market);
  const strategyType = readStrategyType(value.strategyType);
  const entryDigit = readDigit(value.entryDigit);
  const ticksToMonitor = readPositiveInt(value.ticksToMonitor, 20);

  if (!id || !name || !market || !strategyType || entryDigit === null) {
    return null;
  }

  return {
    id,
    name,
    market,
    marketName: readString(value.marketName) ?? market,
    strategyType,
    entryDigit,
    confirmationDigits: readDigitList(value.confirmationDigits),
    ticksToMonitor,
    risk: readRisk(value.risk),
    active: value.active !== false,
    updatedAt: readPositiveInt(value.updatedAt, Date.now()),
  };
}

function readRisk(value: unknown): RiskConfig {
  if (!isRecord(value)) {
    return { ...DEFAULT_RISK_CONFIG };
  }

  return {
    stake: readNonNegativeNumber(value.stake, DEFAULT_RISK_CONFIG.stake),
    maxConsecutiveLosses: readPositiveInt(
      value.maxConsecutiveLosses,
      DEFAULT_RISK_CONFIG.maxConsecutiveLosses,
    ),
    maxSessionLoss: readNonNegativeNumber(
      value.maxSessionLoss,
      DEFAULT_RISK_CONFIG.maxSessionLoss,
    ),
    maxTradesPerSession: readPositiveInt(
      value.maxTradesPerSession,
      DEFAULT_RISK_CONFIG.maxTradesPerSession,
    ),
    maxOpenPaperPositions: readPositiveInt(
      value.maxOpenPaperPositions,
      DEFAULT_RISK_CONFIG.maxOpenPaperPositions,
    ),
    cooldownAfterLossMs: readNonNegativeNumber(
      value.cooldownAfterLossMs,
      DEFAULT_RISK_CONFIG.cooldownAfterLossMs,
    ),
  };
}

function readStrategyType(value: unknown): StrategyType | null {
  if (typeof value !== "string") {
    return null;
  }

  return STRATEGY_TYPES.find((item) => item === value) ?? null;
}

function readDigitList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readDigit)
    .filter((digit): digit is number => digit !== null);
}

function readDigit(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) {
    return null;
  }
  return parsed;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function readNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
