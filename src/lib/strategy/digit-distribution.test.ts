import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDigitBias } from "./digit-bias";
import {
  buildDigitDistribution,
  digitDistributionRows,
  overPercent,
  underPercent,
} from "./digit-distribution";

function repeat(digit: number, count: number): number[] {
  return Array.from({ length: count }, () => digit);
}

test("digit distribution reports even/odd and hottest digit", () => {
  const stats = buildDigitDistribution([0, 1, 2, 2, 2, 7]);
  assert.equal(stats.sampleSize, 6);
  assert.equal(stats.counts[2], 3);
  assert.equal(stats.hottestDigit, 2);
  assert.ok(Math.abs(stats.evenPercent - 66.666) < 0.1);
  assert.ok(Math.abs(overPercent([0, 1, 2, 8], 2) - 25) < 0.01);
  assert.ok(Math.abs(underPercent([0, 1, 2, 8], 7) - 75) < 0.01);
});

test("counts and percentages cover digits 0 through 9", () => {
  const digits = [
    ...repeat(0, 3),
    ...repeat(1, 2),
    ...repeat(2, 5),
    ...repeat(3, 6),
    ...repeat(4, 4),
    ...repeat(5, 4),
    ...repeat(6, 4),
    ...repeat(7, 1),
    ...repeat(8, 2),
    ...repeat(9, 2),
  ];
  const stats = buildDigitDistribution(digits);
  const rows = digitDistributionRows(stats);

  assert.equal(stats.sampleSize, 33);
  assert.deepEqual(stats.counts, [3, 2, 5, 6, 4, 4, 4, 1, 2, 2]);
  assert.equal(rows.length, 10);
  for (const row of rows) {
    assert.equal(row.count, stats.counts[row.digit]);
    assert.ok(Math.abs(row.percent - (row.count / 33) * 100) < 0.0001);
    assert.equal(row.role, stats.roleByDigit[row.digit]);
  }
  assert.equal(stats.ranking.highest, 3);
  assert.equal(stats.ranking.secondHighest, 2);
  assert.equal(stats.ranking.lowest, 7);
  assert.equal(stats.ranking.secondLowest, 1);
});

test("ties break toward the smaller digit and keep four distinct roles", () => {
  const tiedMax = buildDigitDistribution([
    ...repeat(5, 4),
    ...repeat(2, 4),
    ...repeat(9, 3),
    ...repeat(0, 1),
    ...repeat(1, 1),
    ...repeat(3, 2),
    ...repeat(4, 2),
    ...repeat(6, 2),
    ...repeat(7, 2),
    ...repeat(8, 2),
  ]);
  assert.equal(tiedMax.hottestDigit, 2);
  assert.equal(tiedMax.ranking.highest, 2);
  assert.equal(tiedMax.ranking.secondHighest, 5);
  assert.equal(tiedMax.coldestDigit, 0);
  assert.equal(tiedMax.ranking.lowest, 0);
  assert.equal(tiedMax.ranking.secondLowest, 1);

  const allEqual = buildDigitDistribution([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(allEqual.hottestDigit, 0);
  assert.equal(allEqual.coldestDigit, 0);
  assert.equal(allEqual.ranking.highest, 0);
  assert.equal(allEqual.ranking.secondHighest, 1);
  assert.equal(allEqual.ranking.lowest, 2);
  assert.equal(allEqual.ranking.secondLowest, 3);
  assert.deepEqual(
    [...new Set(allEqual.roleByDigit.filter((role) => role !== "neutral"))].sort(),
    ["highest", "lowest", "second-highest", "second-lowest"],
  );
});

test("ranking moves when a new tick changes the leading digit", () => {
  const before = buildDigitDistribution([...repeat(1, 3), ...repeat(2, 2)]);
  const after = buildDigitDistribution([...repeat(1, 3), ...repeat(2, 4)]);

  assert.equal(before.ranking.highest, 1);
  assert.equal(before.ranking.secondHighest, 2);
  assert.equal(after.ranking.highest, 2);
  assert.equal(after.ranking.secondHighest, 1);
  assert.equal(digitDistributionRows(before)[1]?.role, "highest");
  assert.equal(digitDistributionRows(after)[2]?.role, "highest");
});

test("an empty sample has no ranked digits", () => {
  const stats = buildDigitDistribution([]);
  assert.equal(stats.sampleSize, 0);
  assert.equal(stats.ranking.highest, null);
  assert.equal(stats.ranking.secondHighest, null);
  assert.equal(stats.ranking.lowest, null);
  assert.equal(stats.ranking.secondLowest, null);
  assert.ok(digitDistributionRows(stats).every((row) => row.percent === 0 && row.role === "neutral"));
});

test("digit bias uses the same hottest digit without changing the signal threshold", () => {
  const digits = [...repeat(4, 3), ...repeat(8, 7)];
  const distribution = buildDigitDistribution(digits);
  const analysis = analyzeDigitBias(digits);

  assert.equal(analysis.dominantDigit, distribution.hottestDigit);
  assert.equal(analysis.state, "SIGNAL");
  assert.equal(analyzeDigitBias(repeat(1, 9)).state, "COLLECTING");
  assert.equal(analyzeDigitBias([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).state, "MONITORING");
});
