export const MAX_DATASET_TICKS = 20_000;

export type DatasetOrigin = "real" | "synthetic";

export type ProposalSnapshot = {
  contractType: string;
  barrier?: number;
  askPrice: number;
  payout: number;
};

export type NormalizedTick = {
  symbol: string;
  epoch: number;
  quote: number;
  lastDigit: number;
  proposals?: ProposalSnapshot[];
};

export type TickDataset = {
  label: string;
  origin: DatasetOrigin;
  ticks: NormalizedTick[];
};

export type ImportResult =
  | { ok: true; dataset: TickDataset }
  | { ok: false; errors: string[] };

export function importTickDataset(value: unknown): ImportResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["Dataset must be an object."] };
  }
  const record = value as Record<string, unknown>;
  const origin = record.origin;
  const label = record.label;
  if (origin !== "real" && origin !== "synthetic") {
    errors.push("origin must be real or synthetic.");
  }
  if (typeof label !== "string" || label.trim() === "") {
    errors.push("label is required.");
  } else if (origin === "real" && /synthetic/i.test(label)) {
    errors.push("A real dataset label cannot describe itself as synthetic.");
  }
  if (!Array.isArray(record.ticks)) {
    errors.push("ticks must be an array.");
    return { ok: false, errors };
  }
  if (record.ticks.length > MAX_DATASET_TICKS) {
    errors.push(`Dataset exceeds ${MAX_DATASET_TICKS} ticks.`);
  }

  const ticks: NormalizedTick[] = [];
  record.ticks.forEach((entry, index) => {
    const parsed = parseTick(entry, index);
    if (typeof parsed === "string") {
      errors.push(parsed);
      return;
    }
    ticks.push(parsed);
  });
  if (errors.length > 0 || origin !== "real" && origin !== "synthetic" || typeof label !== "string") {
    return { ok: false, errors };
  }

  ticks.sort((left, right) => left.epoch - right.epoch || left.symbol.localeCompare(right.symbol));
  const seen = new Map<string, number>();
  for (const tick of ticks) {
    const previous = seen.get(tick.symbol);
    if (previous !== undefined && tick.epoch <= previous) {
      errors.push(`Duplicate or out-of-order epoch ${tick.epoch} for ${tick.symbol}.`);
    }
    seen.set(tick.symbol, tick.epoch);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    dataset: { label: label.trim(), origin, ticks },
  };
}

export function assertChronological(ticks: readonly NormalizedTick[]): void {
  const seen = new Map<string, number>();
  for (const tick of ticks) {
    const previous = seen.get(tick.symbol);
    if (previous !== undefined && tick.epoch <= previous) {
      throw new Error(`Chronological order violated for ${tick.symbol} at ${tick.epoch}.`);
    }
    seen.set(tick.symbol, tick.epoch);
  }
}

export function groupBySymbol(
  ticks: readonly NormalizedTick[],
): Map<string, NormalizedTick[]> {
  assertChronological(ticks);
  const grouped = new Map<string, NormalizedTick[]>();
  for (const tick of ticks) {
    const series = grouped.get(tick.symbol);
    if (series) {
      series.push(tick);
    } else {
      grouped.set(tick.symbol, [tick]);
    }
  }
  return grouped;
}

function parseTick(value: unknown, index: number): NormalizedTick | string {
  if (!value || typeof value !== "object") {
    return `Tick ${index} is not an object.`;
  }
  const tick = value as Record<string, unknown>;
  if (typeof tick.symbol !== "string" || tick.symbol.trim() === "") {
    return `Tick ${index} is missing a symbol.`;
  }
  if (typeof tick.epoch !== "number" || !Number.isFinite(tick.epoch)) {
    return `Tick ${index} has an invalid epoch.`;
  }
  if (typeof tick.quote !== "number" || !Number.isFinite(tick.quote)) {
    return `Tick ${index} has an invalid quote.`;
  }
  if (!Number.isInteger(tick.lastDigit) || (tick.lastDigit as number) < 0 || (tick.lastDigit as number) > 9) {
    return `Tick ${index} lastDigit must be an integer from 0 to 9.`;
  }
  const proposals = parseProposals(tick.proposals, index);
  if (typeof proposals === "string") {
    return proposals;
  }
  return {
    symbol: tick.symbol.trim(),
    epoch: tick.epoch,
    quote: tick.quote,
    lastDigit: tick.lastDigit as number,
    ...(proposals ? { proposals } : {}),
  };
}

function parseProposals(value: unknown, index: number): ProposalSnapshot[] | undefined | string {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return `Tick ${index} proposals must be an array.`;
  }
  const proposals: ProposalSnapshot[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return `Tick ${index} has a malformed proposal.`;
    }
    const proposal = entry as Record<string, unknown>;
    if (typeof proposal.contractType !== "string" || proposal.contractType.trim() === "") {
      return `Tick ${index} proposal is missing contractType.`;
    }
    if (typeof proposal.askPrice !== "number" || typeof proposal.payout !== "number") {
      return `Tick ${index} proposal prices must be numbers.`;
    }
    if (proposal.barrier !== undefined && typeof proposal.barrier !== "number") {
      return `Tick ${index} proposal barrier is invalid.`;
    }
    proposals.push({
      contractType: proposal.contractType,
      ...(typeof proposal.barrier === "number" ? { barrier: proposal.barrier } : {}),
      askPrice: proposal.askPrice,
      payout: proposal.payout,
    });
  }
  return proposals;
}
