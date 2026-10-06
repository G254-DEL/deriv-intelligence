import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedAuthenticatedAccountRequest } from "../deriv/auth/request-guard";
import { assertAllowedPublicMarketDataRequest } from "../deriv/public-request-guard";
import { buildDigitDistribution } from "../strategy/digit-distribution";
import { LIVE_ORDERS_ENABLED } from "../trading/live-orders";
import { MIN_DIGIT_SAMPLE, MIN_EDGE } from "../trading/specialist-edge";
import { compareLabResults } from "./lab-compare";
import { evaluateLabMonitor } from "./lab-monitor";
import { promoteForPaper } from "./lab-promotion";
import { chronologicalHoldout, PNL_UNAVAILABLE, replayLabVariant } from "./lab-replay";
import {
  MAX_LAB_EXPERIMENTS,
  MAX_LAB_OBSERVATIONS,
  MAX_LAB_VARIANTS,
  addExperiment,
  addVariant,
  appendObservation,
  emptyLabState,
  loadLabState,
  memoryLabStore,
  observationsToTicks,
  saveLabState,
  type LabExperiment,
} from "./lab-store";
import { classifyLabResearch, LAB_VALIDATION_GATES } from "./lab-validation";
import { createLabVariant, operationalVariant, parameterDifferences } from "./lab-variant";
import {
  EVEN_QUALIFIES,
  ODD_QUALIFIES,
  OVER2_QUALIFIES_OVER3_DOES_NOT,
  UNDER7_QUALIFIES_UNDER8_DOES_NOT,
  repeat,
  syntheticDataset,
} from "./fixtures";
import { getStrategy } from "./registry";
import { STRATEGY_DEFINITIONS } from "./strategy-spec";
import type { StrategyMetrics } from "./metrics";
import type { ContractPerformance } from "./lab-replay";
import type { LabVariant } from "./lab-variant";

const QUOTE = [{ contractType: "DIGITUNDER", barrier: 7, askPrice: 0.5, payout: 1 }];

test("five specialists explain the same canonical edge", () => {
  const under7 = monitor("under-7-hunter", UNDER7_QUALIFIES_UNDER8_DOES_NOT);
  assert.equal(under7.state, "ARMED");
  assert.equal(under7.contractType, "DIGITUNDER");
  assert.equal(under7.barrier, 7);
  assert.equal(under7.observedProbability, 16 / 20);
  assert.equal(under7.baselineProbability, 0.7);
  assert.ok(Math.abs((under7.edge ?? 0) - (16 / 20 - 0.7)) < 1e-12);
  assert.match(under7.reason, /Qualified/);
  assert.equal(under7.ordersPlaced, false);

  const under8 = monitor("under-8-hunter", UNDER7_QUALIFIES_UNDER8_DOES_NOT);
  assert.equal(under8.state, "WATCHING");
  assert.equal(under8.edge, 0);
  assert.match(under8.reason, /Edge below/);

  const over2 = monitor("over-2-hunter", OVER2_QUALIFIES_OVER3_DOES_NOT);
  assert.equal(over2.state, "ARMED");
  assert.equal(over2.contractType, "DIGITOVER");
  assert.equal(over2.barrier, 2);
  assert.ok((over2.edge ?? 0) >= MIN_EDGE);

  const over3 = monitor("over-3-hunter", OVER2_QUALIFIES_OVER3_DOES_NOT);
  assert.equal(over3.state, "WATCHING");
  assert.equal(over3.edge, 0);

  const even = monitor("even-odd-hunter", EVEN_QUALIFIES);
  assert.equal(even.state, "ARMED");
  assert.equal(even.contractType, "DIGITEVEN");
  assert.equal(even.evenOddSide, "EVEN");
  assert.equal(even.baselineProbability, 0.5);

  const odd = monitor("even-odd-hunter", ODD_QUALIFIES);
  assert.equal(odd.state, "ARMED");
  assert.equal(odd.contractType, "DIGITODD");
  assert.equal(odd.evenOddSide, "ODD");
});

test("insufficient sample, threshold boundary, and cooldown are explicit", () => {
  const short = monitor("under-7-hunter", repeat(0, 9));
  assert.equal(short.state, "INSUFFICIENT_DATA");
  assert.equal(short.qualified, false);
  assert.match(short.reason, /Current sample is 9/);

  const definition = requiredStrategy("under-7-hunter");
  const wide = createLabVariant({
    definition,
    name: "Under 7 boundary",
    now: 1,
    version: 1,
    overrides: { sampleWindow: 50, minimumSampleSize: 50, minimumEdge: MIN_EDGE },
  });
  assert.equal(wide.ok, true);
  if (!wide.ok) {
    return;
  }
  const atThreshold = evaluateLabMonitor({
    digits: [...repeat(0, 39), ...repeat(9, 11)],
    definition,
    parameters: wide.variant.parameters,
  });
  assert.equal(atThreshold.observedProbability, 39 / 50);
  assert.ok(Math.abs((atThreshold.edge ?? 0) - 0.08) < 1e-12);
  assert.equal(atThreshold.state, "ARMED");

  const below = evaluateLabMonitor({
    digits: [...repeat(0, 38), ...repeat(9, 12)],
    definition,
    parameters: wide.variant.parameters,
  });
  assert.equal(below.state, "WATCHING");
  assert.ok((below.edge ?? 0) < MIN_EDGE);

  const cooling = evaluateLabMonitor({
    digits: repeat(0, 20),
    definition,
    parameters: operationalVariant(definition).parameters,
    tickCooldownActive: true,
  });
  assert.equal(cooling.state, "COOLDOWN");
  assert.equal(cooling.qualified, false);
});

test("digit ranking in the monitor is the canonical distribution", () => {
  const digits = [...repeat(0, 8), ...repeat(1, 5), ...repeat(2, 3), 3, 4];
  const live = monitor("under-7-hunter", digits);
  const canonical = buildDigitDistribution(digits);
  assert.deepEqual(live.distribution.counts, canonical.counts);
  assert.deepEqual(live.distribution.ranking, canonical.ranking);
  assert.equal(live.distribution.ranking.highest, canonical.ranking.highest);
  assert.equal(live.distribution.ranking.secondHighest, canonical.ranking.secondHighest);
  assert.equal(live.distribution.ranking.lowest, canonical.ranking.lowest);
  assert.equal(live.distribution.ranking.secondLowest, canonical.ranking.secondLowest);
});

test("replay settles the next tick and does not read it before entry", () => {
  const definition = requiredStrategy("under-7-hunter");
  const variant = operationalVariant(definition);
  const strict = createLabVariant({
    definition,
    name: "Under 7 full window",
    now: 3,
    version: 2,
    overrides: { minimumSampleSize: 20, minimumEdge: 0.26 },
  });
  assert.equal(strict.ok, true);
  if (!strict.ok) {
    return;
  }
  const lossDigits = [
    ...repeat(0, 20),
    9,
    ...repeat(0, 20),
    9,
    ...repeat(0, 20),
    9,
  ];
  const loss = replayLabVariant({
    definition,
    variant: strict.variant,
    ticks: syntheticDataset({ label: "SYNTHETIC losses", digits: lossDigits }).ticks,
  });
  assert.equal(loss.trades, 3);
  assert.equal(loss.losses, 3);
  assert.equal(loss.wins, 0);
  assert.equal(loss.maximumConsecutiveLosses, 3);
  assert.equal(loss.currentConsecutiveLosses, 3);
  assert.equal(loss.monetaryStatus, "NOT_DETERMINED");
  assert.equal(loss.netProfitLoss, null);
  assert.equal(loss.monetaryNote, PNL_UNAVAILABLE);
  for (const event of loss.tradesTrace) {
    const entryIndex = lossDigits.findIndex((_, index) => {
      const epoch = 1_700_000_000 + index;
      return epoch === event.signalEpoch;
    });
    const causal = lossDigits.slice(0, entryIndex + 1).slice(-20);
    assert.deepEqual(event.sampleDigits, causal);
    assert.equal(event.nextDigit, lossDigits[entryIndex + 1]);
    assert.equal(event.sampleDigits.at(-1), 0);
    assert.equal(event.nextDigit, 9);
    assert.equal(event.won, false);
    assert.equal(event.profitLoss, null);
  }

  const win = replayLabVariant({
    definition,
    variant,
    ticks: syntheticDataset({ label: "SYNTHETIC win", digits: repeat(0, 11) }).ticks,
  });
  assert.equal(win.trades, 1);
  assert.equal(win.wins, 1);
  assert.equal(win.tradesTrace[0]?.won, true);
  assert.equal(win.tradesTrace[0]?.nextDigit, 0);
  assert.equal(win.monetaryStatus, "NOT_DETERMINED");

  const lookahead = replayLabVariant({
    definition,
    variant,
    ticks: syntheticDataset({ label: "SYNTHETIC future", digits: [...repeat(9, 20), 0] }).ticks,
  });
  assert.equal(lookahead.trades, 0);
  assert.equal(lookahead.wins, 0);
});

test("priced replay uses proposal ask and payout and unpriced replay does not invent profit", () => {
  const definition = requiredStrategy("under-7-hunter");
  const variant = operationalVariant(definition);
  const win = replayLabVariant({
    definition,
    variant,
    ticks: syntheticDataset({
      label: "SYNTHETIC priced win",
      digits: repeat(0, 11),
      proposals: QUOTE,
      stepSeconds: 100,
    }).ticks,
  });
  assert.equal(win.monetaryStatus, "AVAILABLE");
  assert.equal(win.trades, 1);
  assert.equal(win.wins, 1);
  assert.equal(win.netProfitLoss, 0.5);
  assert.equal(win.totalStake, 0.5);
  assert.equal(win.grossPayout, 1);

  const loss = replayLabVariant({
    definition,
    variant,
    ticks: syntheticDataset({
      label: "SYNTHETIC priced loss",
      digits: [...repeat(0, 10), 9],
      proposals: QUOTE,
      stepSeconds: 100,
    }).ticks,
  });
  assert.equal(loss.losses, 1);
  assert.equal(loss.netProfitLoss, -0.5);
  assert.equal(loss.tradesTrace[0]?.contractType, "DIGITUNDER");
  assert.equal(loss.tradesTrace[0]?.barrier, 7);
});

test("comparison shows improvements and regressions and does not crown a winner", () => {
  const definition = requiredStrategy("under-7-hunter");
  const current = operationalVariant(definition);
  const strict = createLabVariant({
    definition,
    name: "Under 7 strict",
    now: 2,
    version: 2,
    overrides: { minimumEdge: 0.49 },
  });
  assert.equal(strict.ok, true);
  if (!strict.ok) {
    return;
  }
  const ticks = syntheticDataset({ label: "SYNTHETIC compare", digits: repeat(0, 30) }).ticks;
  const comparison = compareLabResults([
    { name: current.name, performance: replayLabVariant({ definition, variant: current, ticks }) },
    { name: strict.variant.name, performance: replayLabVariant({ definition, variant: strict.variant, ticks }) },
  ]);
  assert.equal(comparison.winner, null);
  assert.match(comparison.note, /win rate alone/);
  const trades = comparison.metrics.find((metric) => metric.label === "Trades");
  assert.ok(trades);
  assert.equal(Number(trades.values[0]) > Number(trades.values[1]), true);
  assert.equal(trades.flags[1], "improvement");
  const wins = comparison.metrics.find((metric) => metric.label === "Wins");
  assert.equal(wins?.flags[1], "regression");
});

test("train and validation stay in chronological order", () => {
  const ticks = syntheticDataset({
    label: "SYNTHETIC split",
    digits: [...repeat(9, 20), ...repeat(0, 20)],
  }).ticks;
  const split = chronologicalHoldout([...ticks].reverse());
  assert.ok(split);
  assert.deepEqual(
    [...split.development, ...split.holdout].map((tick) => tick.epoch),
    ticks.map((tick) => tick.epoch),
  );
  assert.equal(split.development.at(-1)!.epoch < split.holdout[0].epoch, true);
  const definition = requiredStrategy("under-7-hunter");
  const variant = operationalVariant(definition);
  const holdoutKeys = new Set(split.holdout.map((tick) => tick.epoch));
  const holdout = replayLabVariant({
    definition,
    variant,
    ticks,
    scoreFromEpoch: split.holdout[0].epoch,
    scoreTick: (tick) => holdoutKeys.has(tick.epoch),
  });
  assert.ok(holdout.tradesTrace.every((event) => holdoutKeys.has(event.signalEpoch)));
  for (const event of holdout.tradesTrace) {
    const entryIndex = ticks.findIndex((tick) => tick.epoch === event.signalEpoch);
    assert.deepEqual(
      event.sampleDigits,
      ticks.slice(0, entryIndex + 1).map((tick) => tick.lastDigit).slice(-20),
    );
  }
});

test("validation stays closed without enough evidence", () => {
  assert.equal(classifyLabResearch({
    ran: false,
    development: null,
    holdout: null,
    capturedObservations: 0,
  }).status, "DRAFT");
  const fewWins = classifyLabResearch({
    ran: true,
    development: performanceStub({ trades: 5, wins: 5, winRate: 1 }),
    holdout: performanceStub({ trades: 5, wins: 5, winRate: 1 }),
    capturedObservations: 40,
  });
  assert.equal(fewWins.status, "INSUFFICIENT_DATA");
  assert.match(fewWins.reasons[0], /not evidence/);
  assert.equal(LAB_VALIDATION_GATES.minimumObservations, 200);
  assert.equal(LAB_VALIDATION_GATES.minimumOutOfSampleTrades, 30);
});

test("lab storage is bounded and variants do not change operational thresholds", () => {
  const definition = requiredStrategy("under-7-hunter");
  const created = createLabVariant({
    definition,
    name: "Under 7 - Variant A",
    now: 5,
    version: 3,
    overrides: { minimumEdge: 0.12, stake: 50 },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.equal(definition.parameters.minimumEdge, MIN_EDGE);
  assert.equal(definition.parameters.stake, 1);
  assert.equal(created.variant.parameters.minimumEdge, 0.12);
  assert.equal(created.variant.parameters.stake, 1);
  assert.deepEqual(parameterDifferences(definition.parameters, created.variant.parameters), [
    "minimumEdge: 0.08 -> 0.12",
  ]);
  const rejected = createLabVariant({
    definition,
    name: "Bad",
    overrides: { minimumSampleSize: 5 },
  });
  assert.equal(rejected.ok, false);

  let state = emptyLabState();
  state = appendObservation(state, { symbol: "R_10", epoch: 1, quote: 10, lastDigit: 4 });
  state = appendObservation(state, { symbol: "R_10", epoch: 1, quote: 10, lastDigit: 4 });
  state = appendObservation(state, { symbol: "R_10", epoch: 2, quote: 10, lastDigit: 12 });
  assert.equal(state.observations.length, 1);
  for (let index = 0; index < MAX_LAB_OBSERVATIONS + 5; index += 1) {
    state = appendObservation(state, {
      symbol: "R_10",
      epoch: index + 10,
      quote: 10,
      lastDigit: index % 10,
    });
  }
  assert.equal(state.observations.length, MAX_LAB_OBSERVATIONS);
  for (let index = 0; index < MAX_LAB_VARIANTS + 2; index += 1) {
    state = addVariant(state, { ...created.variant, id: `variant-${index}` });
  }
  assert.equal(state.variants.length, MAX_LAB_VARIANTS);
  for (let index = 0; index < MAX_LAB_EXPERIMENTS + 3; index += 1) {
    state = addExperiment(state, experimentStub(`exp-${index}`, index));
  }
  const memory = memoryLabStore();
  const loaded = loadLabState(memoryLabStore());
  assert.equal(loaded.observations.length, 0);
  const saved = saveLabState(memory, state);
  assert.equal(loadLabState(memory).experiments.length, MAX_LAB_EXPERIMENTS);
  assert.equal(saved.experiments.at(-1)?.id, `exp-${MAX_LAB_EXPERIMENTS + 2}`);
  assert.equal(observationsToTicks(saved.observations).every((tick) => tick.proposals === undefined), true);
});

test("paper promotion requires an explicit validated action and cannot enable live orders", () => {
  const definition = requiredStrategy("under-7-hunter");
  const created = createLabVariant({
    definition,
    name: "Under 7 - Variant B",
    now: 9,
    version: 4,
    overrides: { minimumEdge: 0.1 },
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const memory = memoryLabStore();
  const state = emptyLabState();
  const unconfirmed = promoteForPaper({
    state,
    memory,
    variant: { ...created.variant, researchStatus: "VALIDATED_FOR_PAPER" },
    operational: definition.parameters,
    confirmed: false,
  });
  assert.equal(unconfirmed.ok, false);
  const draft = promoteForPaper({
    state,
    memory,
    variant: created.variant,
    operational: definition.parameters,
    confirmed: true,
  });
  assert.equal(draft.ok, false);
  const promoted = promoteForPaper({
    state,
    memory,
    variant: { ...created.variant, researchStatus: "VALIDATED_FOR_PAPER" },
    operational: definition.parameters,
    confirmed: true,
  });
  assert.equal(promoted.ok, true);
  if (!promoted.ok) {
    return;
  }
  assert.equal(promoted.config.paperOnly, true);
  assert.equal(promoted.config.liveOrdersEnabled, false);
  assert.equal(LIVE_ORDERS_ENABLED, false);
  assert.equal(definition.parameters.minimumEdge, MIN_EDGE);
  assert.equal(STRATEGY_DEFINITIONS[0]?.parameters.minimumEdge, MIN_EDGE);
  assert.equal(loadLabState(memory).promoted?.strategyId, created.variant.strategyId);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ buy: 1 }), /buy/i);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ sell: 1 }), /sell/i);
  assert.throws(() => assertAllowedAuthenticatedAccountRequest({ buy: 1 }), /buy/i);
  assert.throws(() => assertAllowedAuthenticatedAccountRequest({ sell: 1 }), /sell/i);
});

function monitor(strategyId: string, digits: number[]) {
  const definition = requiredStrategy(strategyId);
  return evaluateLabMonitor({
    digits,
    definition,
    parameters: operationalVariant(definition).parameters,
  });
}

function requiredStrategy(strategyId: string) {
  const definition = getStrategy(strategyId);
  assert.ok(definition);
  if (!definition) {
    throw new Error(strategyId);
  }
  return definition;
}

function performanceStub(overrides: Partial<ContractPerformance>): ContractPerformance {
  return {
    observations: 40,
    signals: overrides.trades ?? 0,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    lossRate: null,
    currentConsecutiveWins: 0,
    currentConsecutiveLosses: 0,
    maximumConsecutiveWins: 0,
    maximumConsecutiveLosses: 0,
    averageEdge: 0.1,
    skipped: 0,
    skipReasons: [],
    sampleSize: 40,
    monetaryStatus: "NOT_DETERMINED",
    monetaryNote: PNL_UNAVAILABLE,
    netProfitLoss: null,
    totalStake: null,
    grossPayout: null,
    bySymbol: [],
    tradesTrace: [],
    metrics: {} as StrategyMetrics,
    ...overrides,
  };
}

function experimentStub(id: string, timestamp: number): LabExperiment {
  const definition = requiredStrategy("under-7-hunter");
  const variant: LabVariant = operationalVariant(definition);
  return {
    id,
    strategyId: variant.strategyId,
    version: variant.version,
    market: "R_10",
    parameters: variant.parameters,
    fromEpoch: 1,
    toEpoch: 2,
    sampleSize: 2,
    performance: performanceStub({}),
    validationStatus: "DRAFT",
    timestamp,
  };
}
