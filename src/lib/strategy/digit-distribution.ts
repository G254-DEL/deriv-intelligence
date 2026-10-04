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
  };
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
