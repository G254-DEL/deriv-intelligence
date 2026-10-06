export type DigitFeatureSnapshot = {
  sampleSize: number;
  digitFrequency: number[];
  under7Frequency: number;
  under8Frequency: number;
  over2Frequency: number;
  over3Frequency: number;
  evenFrequency: number;
  oddFrequency: number;
  streakLength: number;
  streakDigit: number | null;
  baselineDistance: {
    under7: number;
    under8: number;
    over2: number;
    over3: number;
    even: number;
    odd: number;
  };
  shortLongDivergence: {
    under7: number;
    under8: number;
    over2: number;
    over3: number;
    even: number;
    odd: number;
  };
  rollingEntropy: number;
  distributionImbalance: number;
  transitionMatrix: number[][];
  regimeChange: number;
  lastDigit: number | null;
};

export function computeDigitFeatures(digits: readonly number[]): DigitFeatureSnapshot {
  const valid = digits.filter(
    (digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9,
  );
  const sampleSize = valid.length;
  const counts = Array.from({ length: 10 }, () => 0);
  for (const digit of valid) {
    counts[digit] += 1;
  }
  const frequency = counts.map((count) => (sampleSize === 0 ? 0 : count / sampleSize));
  const share = (predicate: (digit: number) => boolean) =>
    sampleSize === 0 ? 0 : valid.filter(predicate).length / sampleSize;
  const under7 = share((digit) => digit < 7);
  const under8 = share((digit) => digit < 8);
  const over2 = share((digit) => digit > 2);
  const over3 = share((digit) => digit > 3);
  const even = share((digit) => digit % 2 === 0);
  const odd = sampleSize === 0 ? 0 : 1 - even;
  const short = valid.slice(-Math.min(10, sampleSize));
  const shortUnder7 = rate(short, (digit) => digit < 7);
  const shortUnder8 = rate(short, (digit) => digit < 8);
  const shortOver2 = rate(short, (digit) => digit > 2);
  const shortOver3 = rate(short, (digit) => digit > 3);
  const shortEven = rate(short, (digit) => digit % 2 === 0);
  const shortOdd = short.length === 0 ? 0 : 1 - shortEven;
  const divergence = {
    under7: shortUnder7 - under7,
    under8: shortUnder8 - under8,
    over2: shortOver2 - over2,
    over3: shortOver3 - over3,
    even: shortEven - even,
    odd: shortOdd - odd,
  };
  let streakLength = 0;
  let streakDigit: number | null = null;
  if (sampleSize > 0) {
    streakDigit = valid[sampleSize - 1];
    for (let index = sampleSize - 1; index >= 0; index -= 1) {
      if (valid[index] !== streakDigit) {
        break;
      }
      streakLength += 1;
    }
  }

  return {
    sampleSize,
    digitFrequency: frequency,
    under7Frequency: under7,
    under8Frequency: under8,
    over2Frequency: over2,
    over3Frequency: over3,
    evenFrequency: even,
    oddFrequency: odd,
    streakLength,
    streakDigit,
    baselineDistance: {
      under7: under7 - 0.7,
      under8: under8 - 0.8,
      over2: over2 - 0.7,
      over3: over3 - 0.6,
      even: even - 0.5,
      odd: odd - 0.5,
    },
    shortLongDivergence: divergence,
    rollingEntropy: entropy(frequency),
    distributionImbalance:
      sampleSize === 0 ? 0 : Math.max(...frequency) - Math.min(...frequency),
    transitionMatrix: transitionMatrix(valid),
    regimeChange: Math.max(...Object.values(divergence).map((value) => Math.abs(value))),
    lastDigit: streakDigit,
  };
}

function rate(digits: readonly number[], predicate: (digit: number) => boolean): number {
  if (digits.length === 0) {
    return 0;
  }
  return digits.filter(predicate).length / digits.length;
}

function entropy(frequency: readonly number[]): number {
  let total = 0;
  for (const probability of frequency) {
    if (probability > 0) {
      total -= probability * Math.log2(probability);
    }
  }
  return total;
}

function transitionMatrix(digits: readonly number[]): number[][] {
  const counts = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
  for (let index = 1; index < digits.length; index += 1) {
    counts[digits[index - 1]][digits[index]] += 1;
  }
  return counts.map((row) => {
    const total = row.reduce((sum, count) => sum + count, 0);
    return row.map((count) => (total === 0 ? 0 : count / total));
  });
}
