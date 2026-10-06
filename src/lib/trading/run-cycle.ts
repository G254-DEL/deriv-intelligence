import { blockArmedEntries, paperEntryPermitted, type RuntimePhase } from "./runtime-session";
import { decideEntry, type EntryDecision, type EntryPhase } from "./entry-signal";
import type { RouterOpportunity } from "./market-router";
import { fitForStrategy } from "./specialist-edge";
import type { BotStrategy } from "./types";

export function mayOpenPaperTrade(params: {
  role: "router" | "entry" | "specialist";
  entryPhase: EntryPhase;
  liveOrdersEnabled: boolean;
  runtimePhase: RuntimePhase;
}): boolean {
  if (params.role === "router") {
    return false;
  }
  return paperEntryPermitted(
    params.runtimePhase,
    params.entryPhase,
    params.liveOrdersEnabled,
  );
}

export function evaluateAssignmentEntries(params: {
  assignments: Record<string, RouterOpportunity>;
  digits: Record<string, number[]>;
  openSymbols: ReadonlySet<string>;
  phase: RuntimePhase;
  riskAllowed: boolean;
  riskReason: string;
  minimumConfidence: number;
}): Record<string, EntryDecision> {
  const entries: Record<string, EntryDecision> = {};
  for (const [symbol, assignment] of Object.entries(params.assignments)) {
    const decision = decideEntry({
      enabled: true,
      open: params.openSymbols.has(symbol),
      riskAllowed: params.riskAllowed,
      riskReason: params.riskReason,
      minimumConfidence: params.minimumConfidence,
      fit: fitForStrategy(params.digits[symbol] ?? [], assignment.strategy),
    });
    entries[symbol] = blockArmedEntries(params.phase, decision);
  }
  return entries;
}

export function routerCannotExecute(): false {
  return false;
}

export type RouterTableRow = {
  rank: number;
  symbol: string;
  marketName: string;
  strategy: BotStrategy;
  specialist: string;
  probability: number;
  fairProbability: number;
  edge: number;
  sampleSize: number;
  performanceAdjustment: number;
  score: number;
  state: string;
  reason: string;
};

const SPECIALIST_LABEL: Record<BotStrategy, string> = {
  UNDER_7: "Under 7",
  UNDER_8: "Under 8",
  OVER_2: "Over 2",
  OVER_3: "Over 3",
  EVEN_ODD: "Even/Odd",
};

export function routerTableRows(params: {
  assignments: Record<string, RouterOpportunity>;
  entries: Record<string, EntryDecision>;
  openSymbols: ReadonlySet<string>;
}): RouterTableRow[] {
  return Object.values(params.assignments)
    .sort((left, right) => (right.rankScore ?? 0) - (left.rankScore ?? 0) || (left.symbol < right.symbol ? -1 : 1))
    .map((item, index) => {
      const entry = params.entries[item.symbol];
      const state = params.openSymbols.has(item.symbol)
        ? "PAPER_TRADE_OPEN"
        : entry?.phase ?? "WATCHING";
      return {
        rank: index + 1,
        symbol: item.symbol,
        marketName: item.marketName,
        strategy: item.strategy,
        specialist: SPECIALIST_LABEL[item.strategy],
        probability: item.probability ?? item.confidence,
        fairProbability: item.fairProbability,
        edge: item.edge ?? 0,
        sampleSize: item.sampleSize,
        performanceAdjustment: item.performanceAdjustment,
        score: item.rankScore ?? 0,
        state,
        reason:
          item.rank === 1 || index === 0
            ? "strongest qualified opportunity"
            : item.reason ?? "Qualified opportunity",
      };
    });
}
