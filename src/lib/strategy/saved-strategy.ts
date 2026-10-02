import type { RiskConfig } from "@/src/lib/trading/risk";
import { DEFAULT_RISK_CONFIG } from "@/src/lib/trading/risk";

export const STRATEGY_TYPES = [
  "Digit Bias",
  "Under 7",
  "Over 2",
  "Over 3",
  "Under 8",
  "Even/Odd",
  "Matches",
] as const;

export type StrategyType = (typeof STRATEGY_TYPES)[number];

export type SavedStrategy = {
  id: string;
  name: string;
  market: string;
  marketName: string;
  strategyType: StrategyType;
  entryDigit: number;
  confirmationDigits: number[];
  ticksToMonitor: number;
  risk: RiskConfig;
  active: boolean;
  updatedAt: number;
};

export type StrategyDraft = Omit<SavedStrategy, "id" | "updatedAt">;

export function createEmptyDraft(): StrategyDraft {
  return {
    name: "",
    market: "",
    marketName: "",
    strategyType: "Under 7",
    entryDigit: 4,
    confirmationDigits: [5, 6],
    ticksToMonitor: 20,
    risk: { ...DEFAULT_RISK_CONFIG },
    active: true,
  };
}

export function draftFromStrategy(strategy: SavedStrategy): StrategyDraft {
  return {
    name: strategy.name,
    market: strategy.market,
    marketName: strategy.marketName,
    strategyType: strategy.strategyType,
    entryDigit: strategy.entryDigit,
    confirmationDigits: [...strategy.confirmationDigits],
    ticksToMonitor: strategy.ticksToMonitor,
    risk: { ...strategy.risk },
    active: strategy.active,
  };
}
