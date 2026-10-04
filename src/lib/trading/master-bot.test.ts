import assert from "node:assert/strict";
import test from "node:test";
import type { DigitAnalysis } from "../strategy/digit-bias";
import {
  assignSpecialistMarkets,
  opportunityFromAnalysis,
  rankOpportunities,
} from "./master-bot";

function analysis(
  overrides: Partial<DigitAnalysis> = {},
): DigitAnalysis {
  return {
    strategy: "Digit Bias",
    state: "SIGNAL",
    dominantDigit: 1,
    dominantFrequency: 0.4,
    sampleSize: 20,
    ...overrides,
  };
}

test("high digits map to Under 7/8 and low digits map to Over 2/3", () => {
  const under8 = opportunityFromAnalysis("R_10", "V10", analysis({ dominantDigit: 8 }));
  const under7 = opportunityFromAnalysis("R_25", "V25", analysis({ dominantDigit: 7 }));
  const over2 = opportunityFromAnalysis("R_50", "V50", analysis({ dominantDigit: 1 }));
  const over3 = opportunityFromAnalysis("R_75", "V75", analysis({ dominantDigit: 3 }));
  const even = opportunityFromAnalysis("R_100", "V100", analysis({ dominantDigit: 4 }));

  assert.equal(under8?.strategy, "UNDER_8");
  assert.equal(under7?.strategy, "UNDER_7");
  assert.equal(over2?.strategy, "OVER_2");
  assert.equal(over3?.strategy, "OVER_3");
  assert.equal(even?.strategy, "EVEN_ODD");
  assert.equal(under8?.ready, true);
});

test("master assigns each specialist a unique higher-confidence market", () => {
  const ranked = rankOpportunities([
    opportunityFromAnalysis("R_10", "V10", analysis({ dominantDigit: 1, dominantFrequency: 0.5 }))!,
    opportunityFromAnalysis("1HZ10V", "V10 1s", analysis({ dominantDigit: 0, dominantFrequency: 0.3 }))!,
    opportunityFromAnalysis("R_25", "V25", analysis({ dominantDigit: 8, dominantFrequency: 0.45 }))!,
    opportunityFromAnalysis("R_75", "V75", analysis({ dominantDigit: 7, dominantFrequency: 0.35 }))!,
    opportunityFromAnalysis("R_100", "V100", analysis({ dominantDigit: 4, dominantFrequency: 0.28 }))!,
  ]);

  const assigned = assignSpecialistMarkets(ranked);
  assert.equal(assigned.OVER_2?.symbol, "R_10");
  assert.equal(assigned.UNDER_8?.symbol, "R_25");
  assert.equal(assigned.UNDER_7?.symbol, "R_75");
  assert.equal(assigned.EVEN_ODD?.symbol, "R_100");
  assert.equal(assigned.OVER_3, null);

  const excluded = assignSpecialistMarkets(ranked, new Set(["R_10"]));
  assert.equal(excluded.OVER_2?.symbol, "1HZ10V");
});
