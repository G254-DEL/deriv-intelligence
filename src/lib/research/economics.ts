export const ECONOMIC_SAFETY_MARGIN = 0.02;

export type EconomicAssessment = {
  breakEvenProbability: number | null;
  economicEdge: number | null;
  expectedValue: number | null;
  equivalentNetExpectedValue: number | null;
  economicallyQualified: boolean;
};

export function breakEvenProbability(askPrice: number, payout: number): number | null {
  if (!Number.isFinite(askPrice) || !Number.isFinite(payout) || askPrice <= 0 || payout <= askPrice) {
    return null;
  }
  return askPrice / payout;
}

export function expectedContractValue(
  predictedProbability: number,
  askPrice: number,
  payout: number,
): number | null {
  if (!Number.isFinite(predictedProbability) || predictedProbability < 0 || predictedProbability > 1) {
    return null;
  }
  const breakEven = breakEvenProbability(askPrice, payout);
  if (breakEven === null) {
    return null;
  }
  return predictedProbability * payout - askPrice;
}

export function equivalentNetExpectedValue(
  predictedProbability: number,
  askPrice: number,
  payout: number,
): number | null {
  if (!Number.isFinite(predictedProbability)) {
    return null;
  }
  if (!Number.isFinite(askPrice) || !Number.isFinite(payout) || askPrice <= 0 || payout <= askPrice) {
    return null;
  }
  const profit = payout - askPrice;
  return predictedProbability * profit - (1 - predictedProbability) * askPrice;
}

export function assessEconomics(
  predictedProbability: number,
  askPrice: number | null,
  payout: number | null,
  safetyMargin = ECONOMIC_SAFETY_MARGIN,
): EconomicAssessment {
  if (askPrice === null || payout === null) {
    return {
      breakEvenProbability: null,
      economicEdge: null,
      expectedValue: null,
      equivalentNetExpectedValue: null,
      economicallyQualified: false,
    };
  }
  const breakEven = breakEvenProbability(askPrice, payout);
  const expectedValue = expectedContractValue(predictedProbability, askPrice, payout);
  return {
    breakEvenProbability: breakEven,
    economicEdge: breakEven === null ? null : predictedProbability - breakEven,
    expectedValue,
    equivalentNetExpectedValue: equivalentNetExpectedValue(
      predictedProbability,
      askPrice,
      payout,
    ),
    economicallyQualified:
      breakEven !== null && predictedProbability >= breakEven + safetyMargin,
  };
}
