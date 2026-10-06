import type { ProposalSnapshot, TickDataset } from "./dataset";

export const SYNTHETIC_ORIGIN = "synthetic" as const;

export const UNDER7_QUALIFIES_UNDER8_DOES_NOT = [
  ...repeat(0, 16),
  ...repeat(9, 4),
];

export const OVER2_QUALIFIES_OVER3_DOES_NOT = [
  ...repeat(0, 4),
  ...repeat(3, 4),
  ...repeat(5, 12),
];

export const EVEN_QUALIFIES = [...repeat(0, 15), ...repeat(1, 5)];
export const ODD_QUALIFIES = [...repeat(1, 15), ...repeat(0, 5)];
export const NEUTRAL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function syntheticDataset(params: {
  label: string;
  symbol?: string;
  digits: readonly number[];
  proposals?: ProposalSnapshot[];
  startEpoch?: number;
  stepSeconds?: number;
}): TickDataset {
  const symbol = params.symbol ?? "SYNTHETIC_R";
  const step = params.stepSeconds ?? 1;
  return {
    label: params.label.startsWith("SYNTHETIC") ? params.label : `SYNTHETIC ${params.label}`,
    origin: SYNTHETIC_ORIGIN,
    ticks: params.digits.map((lastDigit, index) => ({
      symbol,
      epoch: (params.startEpoch ?? 1_700_000_000) + index * step,
      quote: 100 + lastDigit / 10,
      lastDigit,
      ...(params.proposals ? { proposals: params.proposals } : {}),
    })),
  };
}

export function repeat(digit: number, count: number): number[] {
  return Array.from({ length: count }, () => digit);
}
