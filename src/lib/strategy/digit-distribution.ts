export type DigitRankRole =
  | "highest"
  | "second-highest"
  | "lowest"
  | "second-lowest"
  | "neutral";

export type DigitFrequencyRanking = {
  highest: number | null;
  secondHighest: number | null;
  lowest: number | null;
  secondLowest: number | null;
  roleByDigit: DigitRankRole[];
};

export type DigitDistributionRow = {
  digit: number;
  count: number;
  percent: number;
  role: DigitRankRole;
};

export type DigitDistribution = {
  sampleSize: number;
  counts: number[];
  percents: number[];
  evenCount: number;
  oddCount: number;
  evenPercent: number;
  oddPercent: number;
  hottestDigit: number | null;
  coldestDigit: number | null;
  ranking: DigitFrequencyRanking;
  roleByDigit: DigitRankRole[];
};

export function buildDigitDistribution(digits: number[]): DigitDistribution {
  const counts = Array.from({ length: 10 }, () => 0);
  let evenCount = 0;
  let oddCount = 0;

  for (const digit of digits) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
      continue;
    }
    counts[digit] += 1;
    if (digit % 2 === 0) {
      evenCount += 1;
    } else {
      oddCount += 1;
    }
  }

  const sampleSize = counts.reduce((sum, value) => sum + value, 0);
  const percents = counts.map((count) =>
    sampleSize === 0 ? 0 : (count / sampleSize) * 100,
  );

  let hottestDigit: number | null = null;
  let coldestDigit: number | null = null;
  if (sampleSize > 0) {
    hottestDigit = percents.indexOf(Math.max(...percents));
    coldestDigit = percents.indexOf(Math.min(...percents));
  }

  const ranking = rankDigitFrequencies(counts);

  return {
    sampleSize,
    counts,
    percents,
    evenCount,
    oddCount,
    evenPercent: sampleSize === 0 ? 0 : (evenCount / sampleSize) * 100,
    oddPercent: sampleSize === 0 ? 0 : (oddCount / sampleSize) * 100,
    hottestDigit,
    coldestDigit,
    ranking,
    roleByDigit: ranking.roleByDigit,
  };
}

const DIGIT_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function neutralRoles(): DigitRankRole[] {
  return DIGIT_INDEXES.map(() => "neutral");
}

/**
 * Rank digits 0–9 by observed count.
 * Ties break toward the smaller digit, matching indexOf on the count array.
 * Highest and second-highest are assigned first. Lowest and second-lowest
 * are then chosen from the remaining digits, so one digit never holds two roles.
 */
export function rankDigitFrequencies(counts: number[]): DigitFrequencyRanking {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) {
    return {
      highest: null,
      secondHighest: null,
      lowest: null,
      secondLowest: null,
      roleByDigit: neutralRoles(),
    };
  }

  const byFrequency = [...DIGIT_INDEXES].sort(
    (left, right) => (counts[right] ?? 0) - (counts[left] ?? 0) || left - right,
  );
  const highest = byFrequency[0] ?? null;
  const secondHighest = byFrequency[1] ?? null;
  const taken = new Set<number>();
  if (highest !== null) {
    taken.add(highest);
  }
  if (secondHighest !== null) {
    taken.add(secondHighest);
  }
  const byScarcity = DIGIT_INDEXES.filter((digit) => !taken.has(digit)).sort(
    (left, right) => (counts[left] ?? 0) - (counts[right] ?? 0) || left - right,
  );
  const lowest = byScarcity[0] ?? null;
  const secondLowest = byScarcity[1] ?? null;
  const roleByDigit = neutralRoles();

  if (highest !== null) {
    roleByDigit[highest] = "highest";
  }
  if (secondHighest !== null) {
    roleByDigit[secondHighest] = "second-highest";
  }
  if (lowest !== null) {
    roleByDigit[lowest] = "lowest";
  }
  if (secondLowest !== null) {
    roleByDigit[secondLowest] = "second-lowest";
  }

  return {
    highest,
    secondHighest,
    lowest,
    secondLowest,
    roleByDigit,
  };
}

export function digitDistributionRows(
  distribution: DigitDistribution,
): DigitDistributionRow[] {
  return DIGIT_INDEXES.map((digit) => ({
    digit,
    count: distribution.counts[digit] ?? 0,
    percent: distribution.percents[digit] ?? 0,
    role: distribution.roleByDigit[digit] ?? "neutral",
  }));
}

export function overPercent(digits: number[], barrier: number): number {
  const valid = digits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  if (valid.length === 0) {
    return 0;
  }
  return (valid.filter((digit) => digit > barrier).length / valid.length) * 100;
}

export function underPercent(digits: number[], barrier: number): number {
  const valid = digits.filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
  if (valid.length === 0) {
    return 0;
  }
  return (valid.filter((digit) => digit < barrier).length / valid.length) * 100;
}
