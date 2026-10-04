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

export function evaluateSpecialists(digits: number[]): SpecialistFit[] {
  const valid = digits.filter(
    (digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9,
  );
  const sampleSize = valid.length;
  const under7 = share(valid, (digit) => digit < 7);
  const under8 = share(valid, (digit) => digit < 8);
  const over2 = share(valid, (digit) => digit > 2);
  const over3 = share(valid, (digit) => digit > 3);
  const even = share(valid, (digit) => digit % 2 === 0);
  const odd = sampleSize === 0 ? 0 : 1 - even;

  return [
    barrierFit("UNDER_7", "DIGITUNDER", 7, under7, sampleSize),
    barrierFit("UNDER_8", "DIGITUNDER", 8, under8, sampleSize),
    barrierFit("OVER_2", "DIGITOVER", 2, over2, sampleSize),
    barrierFit("OVER_3", "DIGITOVER", 3, over3, sampleSize),
    parityFit(even, odd, sampleSize),
  ];
}

export function fitForStrategy(
  digits: number[],
  strategy: BotStrategy,
): SpecialistFit | null {
  return evaluateSpecialists(digits).find((fit) => fit.strategy === strategy) ?? null;
}

function barrierFit(
  strategy: BotStrategy,
  contractType: string,
  barrier: number,
  probability: number,
  sampleSize: number,
): SpecialistFit {
  const fairProbability = FAIR_PROBABILITY[strategy];
  const edge = probability - fairProbability;
  const qualified = sampleSize >= MIN_DIGIT_SAMPLE && edge >= MIN_EDGE;
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
      : sampleSize < MIN_DIGIT_SAMPLE
        ? "Insufficient sample"
        : "Edge below the live threshold",
  };
}

function parityFit(even: number, odd: number, sampleSize: number): SpecialistFit {
  const evenEdge = even - FAIR_PROBABILITY.EVEN_ODD;
  const oddEdge = odd - FAIR_PROBABILITY.EVEN_ODD;
  const evenQualified = sampleSize >= MIN_DIGIT_SAMPLE && evenEdge >= MIN_EDGE;
  const oddQualified = sampleSize >= MIN_DIGIT_SAMPLE && oddEdge >= MIN_EDGE;
  const chooseEven = evenQualified && even >= odd;
  const chooseOdd = oddQualified && odd > even;
  const qualified = chooseEven || chooseOdd;
  const probability = chooseOdd ? odd : even;
  const edge = chooseOdd ? oddEdge : evenEdge;

  let reason = "Neither even nor odd has sufficient bias";
  if (sampleSize < MIN_DIGIT_SAMPLE) {
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

function share(digits: number[], predicate: (digit: number) => boolean): number {
  if (digits.length === 0) {
    return 0;
  }
  return digits.filter(predicate).length / digits.length;
}
