import { buildDigitDistribution } from "../strategy/digit-distribution";
import type { BotStrategy } from "./types";

export const MIN_DIGIT_SAMPLE = 10;
export const MIN_EDGE = 0.08;

export const FAIR_PROBABILITY: Record<BotStrategy, number> = {
  UNDER_7: 0.7,
  UNDER_8: 0.8,
  OVER_2: 0.7,
  OVER_3: 0.6,
  EVEN_ODD: 0.5,
};

export type SpecialistFit = {
  strategy: BotStrategy;
  contractType: string;
  barrier?: number;
  evenOddSide?: "EVEN" | "ODD";
  probability: number;
  fairProbability: number;
  edge: number;
  sampleSize: number;
  qualified: boolean;
  reason: string;
};

export type EdgeThresholds = {
  minimumSampleSize: number;
  minimumEdge: number;
};

export function evaluateSpecialists(
  digits: number[],
  thresholds: EdgeThresholds = {
    minimumSampleSize: MIN_DIGIT_SAMPLE,
    minimumEdge: MIN_EDGE,
  },
): SpecialistFit[] {
  const distribution = buildDigitDistribution(digits);
  const sampleSize = distribution.sampleSize;
  const under7 = countShare(distribution.counts, sampleSize, (digit) => digit < 7);
  const under8 = countShare(distribution.counts, sampleSize, (digit) => digit < 8);
  const over2 = countShare(distribution.counts, sampleSize, (digit) => digit > 2);
  const over3 = countShare(distribution.counts, sampleSize, (digit) => digit > 3);
  const even = sampleSize === 0 ? 0 : distribution.evenCount / sampleSize;
  const odd = sampleSize === 0 ? 0 : distribution.oddCount / sampleSize;

  return [
    barrierFit("UNDER_7", "DIGITUNDER", 7, under7, sampleSize, thresholds),
    barrierFit("UNDER_8", "DIGITUNDER", 8, under8, sampleSize, thresholds),
    barrierFit("OVER_2", "DIGITOVER", 2, over2, sampleSize, thresholds),
    barrierFit("OVER_3", "DIGITOVER", 3, over3, sampleSize, thresholds),
    parityFit(even, odd, sampleSize, thresholds),
  ];
}

export function fitForStrategy(
  digits: number[],
  strategy: BotStrategy,
  thresholds?: EdgeThresholds,
): SpecialistFit | null {
  return (
    evaluateSpecialists(digits, thresholds).find((fit) => fit.strategy === strategy) ??
    null
  );
}

export function digitMatchesFit(digit: number, fit: SpecialistFit): boolean {
  switch (fit.strategy) {
    case "UNDER_7":
      return digit < 7;
    case "UNDER_8":
      return digit < 8;
    case "OVER_2":
      return digit > 2;
    case "OVER_3":
      return digit > 3;
    case "EVEN_ODD":
      return fit.evenOddSide === "ODD" ? digit % 2 === 1 : digit % 2 === 0;
  }
}

function barrierFit(
  strategy: BotStrategy,
  contractType: string,
  barrier: number,
  probability: number,
  sampleSize: number,
  thresholds: EdgeThresholds,
): SpecialistFit {
  const fairProbability = FAIR_PROBABILITY[strategy];
  const edge = probability - fairProbability;
  const qualified =
    sampleSize >= thresholds.minimumSampleSize && edge >= thresholds.minimumEdge;
  return {
    strategy,
    contractType,
    barrier,
    probability,
    fairProbability,
    edge,
    sampleSize,
    qualified,
    reason: qualified
      ? `${contractType} ${barrier} probability ${(probability * 100).toFixed(1)}%`
      : sampleSize < thresholds.minimumSampleSize
        ? "Insufficient sample"
        : "Edge below the live threshold",
  };
}

function parityFit(
  even: number,
  odd: number,
  sampleSize: number,
  thresholds: EdgeThresholds,
): SpecialistFit {
  const evenEdge = even - FAIR_PROBABILITY.EVEN_ODD;
  const oddEdge = odd - FAIR_PROBABILITY.EVEN_ODD;
  const evenQualified =
    sampleSize >= thresholds.minimumSampleSize && evenEdge >= thresholds.minimumEdge;
  const oddQualified =
    sampleSize >= thresholds.minimumSampleSize && oddEdge >= thresholds.minimumEdge;
  const chooseEven = evenQualified && even >= odd;
  const chooseOdd = oddQualified && odd > even;
  const qualified = chooseEven || chooseOdd;
  const probability = chooseOdd ? odd : even;
  const edge = chooseOdd ? oddEdge : evenEdge;

  let reason = "Neither even nor odd has sufficient bias";
  if (sampleSize < thresholds.minimumSampleSize) {
    reason = "Insufficient sample";
  } else if (chooseEven) {
    reason = `DIGITEVEN probability ${(even * 100).toFixed(1)}%`;
  } else if (chooseOdd) {
    reason = `DIGITODD probability ${(odd * 100).toFixed(1)}%`;
  }

  return {
    strategy: "EVEN_ODD",
    contractType: chooseOdd ? "DIGITODD" : "DIGITEVEN",
    evenOddSide: chooseOdd ? "ODD" : chooseEven ? "EVEN" : undefined,
    probability,
    fairProbability: FAIR_PROBABILITY.EVEN_ODD,
    edge: qualified ? edge : Math.max(evenEdge, oddEdge),
    sampleSize,
    qualified,
    reason,
  };
}

function countShare(
  counts: number[],
  sampleSize: number,
  predicate: (digit: number) => boolean,
): number {
  if (sampleSize === 0) {
    return 0;
  }
  let matches = 0;
  for (let digit = 0; digit < counts.length; digit += 1) {
    if (predicate(digit)) {
      matches += counts[digit] ?? 0;
    }
  }
  return matches / sampleSize;
}
