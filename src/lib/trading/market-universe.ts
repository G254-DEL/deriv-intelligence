import { isPublicDigitMarket } from "../deriv/classify-market";
import type { DerivActiveSymbol } from "../deriv/types";
import type { BotStrategy } from "./types";

/**
 * Synthetic and volatility families the digit router may monitor.
 * Forex, crypto, stocks, and commodities are never candidates.
 * A candidate is not a tradeable pair until contracts_for confirms
 * the specialist's digit contract. Missing metadata fails closed.
 */
const REJECTED_MARKETS = new Set([
  "forex",
  "cryptocurrency",
  "crypto",
  "commodities",
  "commodity",
  "indices",
  "stock_indices",
  "stocks",
  "stock",
  "basket",
]);

export const DIGIT_CONTRACT_TYPES = [
  "DIGITUNDER",
  "DIGITOVER",
  "DIGITEVEN",
  "DIGITODD",
] as const;

export type ParsedDigitContracts = {
  status: "unknown" | "available" | "unsupported";
  types: string[];
  barriers: Partial<Record<string, number[]>>;
};

export type EligibleMarket = {
  symbol: string;
  displayName: string;
  market: string;
  submarket: string;
};

export function knownDigitContracts(
  types: readonly string[] = DIGIT_CONTRACT_TYPES,
  barriers: Partial<Record<string, number[]>> = {},
): ParsedDigitContracts {
  return {
    status: "available",
    types: [...types],
    barriers,
  };
}

export function unknownDigitContracts(): ParsedDigitContracts {
  return { status: "unknown", types: [], barriers: {} };
}

export function discoverEligibleMarkets(
  symbols: readonly DerivActiveSymbol[],
): EligibleMarket[] {
  const discovered: EligibleMarket[] = [];
  const seen = new Set<string>();

  for (const symbol of symbols) {
    if (!isRouterCandidate(symbol)) {
      continue;
    }
    const code = symbol.underlying_symbol.trim();
    if (seen.has(code)) {
      continue;
    }
    seen.add(code);
    discovered.push({
      symbol: code,
      displayName: symbol.underlying_symbol_name?.trim() || code,
      market: symbol.market?.trim() || "synthetic_index",
      submarket: symbol.submarket?.trim() || "",
    });
  }

  discovered.sort((left, right) => (left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0));
  return discovered;
}

export function isRouterCandidate(symbol: DerivActiveSymbol): boolean {
  const code = symbol.underlying_symbol?.trim() ?? "";
  if (!code || !isPublicDigitMarket(symbol)) {
    return false;
  }
  if (symbol.is_trading_suspended === 1 || symbol.exchange_is_open === 0) {
    return false;
  }
  const market = symbol.market?.toLowerCase().trim() ?? "";
  const submarket = symbol.submarket?.toLowerCase().trim() ?? "";
  if (REJECTED_MARKETS.has(market) || REJECTED_MARKETS.has(submarket)) {
    return false;
  }
  return true;
}

export function parseDigitContracts(payload: unknown): ParsedDigitContracts {
  if (!payload || (typeof payload !== "object" && !Array.isArray(payload))) {
    return unknownDigitContracts();
  }

  const found = new Map<string, Set<number>>();
  collectContracts(payload, found, 0);
  const types = [...found.keys()].filter((type) => type.startsWith("DIGIT")).sort();
  if (types.length === 0) {
    return { status: "unsupported", types: [], barriers: {} };
  }

  const barriers: Partial<Record<string, number[]>> = {};
  for (const type of types) {
    const values = [...(found.get(type) ?? [])].sort((left, right) => left - right);
    if (values.length > 0) {
      barriers[type] = values;
    }
  }
  return { status: "available", types, barriers };
}

export function contractSupported(
  contracts: ParsedDigitContracts | undefined,
  contractType: string,
  barrier?: number,
): boolean {
  if (!contracts || contracts.status !== "available") {
    return false;
  }
  if (!contracts.types.includes(contractType)) {
    return false;
  }
  if (barrier === undefined) {
    return true;
  }
  const listed = contracts.barriers[contractType];
  if (!listed || listed.length === 0) {
    return true;
  }
  return listed.includes(barrier);
}

export function specialistContract(
  strategy: BotStrategy,
  evenOddSide?: "EVEN" | "ODD",
): { contractType: string; barrier?: number } {
  switch (strategy) {
    case "UNDER_7":
      return { contractType: "DIGITUNDER", barrier: 7 };
    case "UNDER_8":
      return { contractType: "DIGITUNDER", barrier: 8 };
    case "OVER_2":
      return { contractType: "DIGITOVER", barrier: 2 };
    case "OVER_3":
      return { contractType: "DIGITOVER", barrier: 3 };
    case "EVEN_ODD":
      return { contractType: evenOddSide === "ODD" ? "DIGITODD" : "DIGITEVEN" };
  }
}

function collectContracts(
  value: unknown,
  found: Map<string, Set<number>>,
  depth: number,
): void {
  if (depth > 8 || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectContracts(item, found, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const contractType = readType(record.contract_type);
  if (contractType) {
    const barriers = found.get(contractType) ?? new Set<number>();
    for (const barrier of readBarriers(record)) {
      barriers.add(barrier);
    }
    found.set(contractType, barriers);
  }

  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectContracts(child, found, depth + 1);
    }
  }
}

function readType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

function readBarriers(record: Record<string, unknown>): number[] {
  const values: number[] = [];
  if (Array.isArray(record.last_digit_range)) {
    for (const choice of record.last_digit_range) {
      const parsed = digitBarrier(choice);
      if (parsed !== null) {
        values.push(parsed);
      }
    }
  }
  const single = digitBarrier(record.barrier);
  if (single !== null) {
    values.push(single);
  }
  return values;
}

function digitBarrier(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) {
    return null;
  }
  return parsed;
}
