import type { ContractPerformance } from "./lab-replay";
import type { LabResearchStatus } from "./lab-variant";

export const LAB_VALIDATION_GATES = Object.freeze({
  minimumObservations: 200,
  minimumOutOfSampleTrades: 30,
  maximumConsecutiveLosses: 8,
  maximumTrainHoldoutWinRateGap: 0.25,
  maximumNegativeMonetaryExpectancy: 0,
});

export function classifyLabResearch(params: {
  ran: boolean;
  development: ContractPerformance | null;
  holdout: ContractPerformance | null;
  capturedObservations: number;
}): { status: LabResearchStatus; reasons: string[] } {
  if (!params.ran) {
    return {
      status: "DRAFT",
      reasons: ["No replay has been run for this variant."],
    };
  }
  const holdout = params.holdout;
  const development = params.development;
  if (
    params.capturedObservations < LAB_VALIDATION_GATES.minimumObservations ||
    !holdout ||
    holdout.trades < LAB_VALIDATION_GATES.minimumOutOfSampleTrades
  ) {
    return {
      status: "INSUFFICIENT_DATA",
      reasons: [
        `${params.capturedObservations} observations. Need at least ${LAB_VALIDATION_GATES.minimumObservations} observations and ${LAB_VALIDATION_GATES.minimumOutOfSampleTrades} out-of-sample contract trades. A short win streak is not evidence.`,
      ],
    };
  }
  const reasons: string[] = [];
  if (holdout.maximumConsecutiveLosses > LAB_VALIDATION_GATES.maximumConsecutiveLosses) {
    reasons.push(
      `Out-of-sample loss streak ${holdout.maximumConsecutiveLosses} exceeds ${LAB_VALIDATION_GATES.maximumConsecutiveLosses}.`,
    );
  }
  if (
    development?.winRate !== null &&
    development?.winRate !== undefined &&
    holdout.winRate !== null &&
    Math.abs(development.winRate - holdout.winRate) >
      LAB_VALIDATION_GATES.maximumTrainHoldoutWinRateGap
  ) {
    reasons.push(
      "Training and out-of-sample win rates differ by more than 25 points. The result is unstable.",
    );
  }
  if (
    holdout.monetaryStatus === "AVAILABLE" &&
    holdout.netProfitLoss !== null &&
    holdout.trades > 0 &&
    holdout.netProfitLoss / holdout.trades <
      LAB_VALIDATION_GATES.maximumNegativeMonetaryExpectancy
  ) {
    reasons.push("Out-of-sample monetary expectancy is negative where proposal prices exist.");
  }
  if (reasons.length > 0) {
    return { status: "REJECTED", reasons };
  }
  if (holdout.monetaryStatus !== "AVAILABLE") {
    return {
      status: "TESTING",
      reasons: [
        "Contract outcomes are stable enough to keep testing, but proposal prices were not captured, so profitability is not determined and paper promotion stays closed.",
      ],
    };
  }
  return {
    status: "VALIDATED_FOR_PAPER",
    reasons: [
      "Out-of-sample contract results cleared the stability gates and priced P/L was not negative. This is permission to paper-test, not a profit guarantee.",
    ],
  };
}
