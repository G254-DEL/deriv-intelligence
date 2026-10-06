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

export type PipelineState = "WATCHING" | "SIGNAL" | "BLOCKED" | "PAPER";

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
  state: PipelineState;
  slotEligible: boolean;
  reason: string;
};

export function pipelineState(entry: EntryDecision | undefined, open: boolean): PipelineState {
  if (open || entry?.phase === "PAPER_TRADE_OPEN") {
    return "PAPER";
  }
  if (!entry || entry.phase === "IDLE") {
    return "WATCHING";
  }
  if (entry.phase === "ARMED" || entry.phase === "SIGNAL") {
    return "SIGNAL";
  }
  if (entry.phase === "WATCHING" && /insufficient sample/i.test(entry.reason)) {
    return "WATCHING";
  }
  return "BLOCKED";
}

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
      const open = params.openSymbols.has(item.symbol);
      const state = pipelineState(entry, open);
      const score = item.rankScore ?? 0;
      const evidence = rankingEvidence(
        item.reason,
        score,
        item.edge ?? 0,
        item.sampleSize,
        item.performanceAdjustment,
      );
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
        score,
        state,
        slotEligible: entry?.phase === "ARMED" && entry.armed && !open,
        reason: state === "BLOCKED" && entry ? `${entry.reason}. ${evidence}` : evidence,
      };
    });
}

export function applyPaperSlotLimits(
  rows: RouterTableRow[],
  openSymbols: ReadonlySet<string>,
  maxOpen: number,
): { rows: RouterTableRow[]; slots: Set<string> } {
  const room = Math.max(0, maxOpen - openSymbols.size);
  const chosen = rows
    .filter((row) => row.slotEligible)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, room);
  const slots = new Set(chosen.map((row) => row.symbol));
  return {
    slots,
    rows: rows.map((row) => {
      if (!row.slotEligible || slots.has(row.symbol)) {
        return row;
      }
      return {
        ...row,
        state: "BLOCKED",
        slotEligible: false,
        reason: `Open paper slots are full (${maxOpen}). Higher-ranked markets are ahead.`,
      };
    }),
  };
}

function rankingEvidence(
  evidence: string | undefined,
  score: number,
  edge: number,
  sampleSize: number,
  performanceAdjustment: number,
): string {
  const base = evidence && evidence.length > 0 ? evidence : "Qualified on rolling digit evidence";
  return `${base}. Score ${score.toFixed(4)} from edge ${edge.toFixed(4)}, sample ${sampleSize}, performance adjustment ${performanceAdjustment.toFixed(3)}.`;
}
