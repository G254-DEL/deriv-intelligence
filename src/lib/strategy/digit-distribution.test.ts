import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDigitDistribution,
  overPercent,
  underPercent,
} from "./digit-distribution";

test("digit distribution reports even/odd and hottest digit", () => {
  const stats = buildDigitDistribution([0, 1, 2, 2, 2, 7]);
  assert.equal(stats.sampleSize, 6);
  assert.equal(stats.counts[2], 3);
  assert.equal(stats.hottestDigit, 2);
  assert.ok(Math.abs(stats.evenPercent - 66.666) < 0.1);
  assert.ok(Math.abs(overPercent([0, 1, 2, 8], 2) - 25) < 0.01);
  assert.ok(Math.abs(underPercent([0, 1, 2, 8], 7) - 75) < 0.01);
});
