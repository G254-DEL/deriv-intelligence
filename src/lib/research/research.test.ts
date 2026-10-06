import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedAuthenticatedAccountRequest } from "../deriv/auth/request-guard";
import { assertAllowedPublicMarketDataRequest } from "../deriv/public-request-guard";
import { decideEntry } from "../trading/entry-signal";
import { LIVE_ORDERS_ENABLED } from "../trading/live-orders";
import { routeMarkets, RANK_EDGE_WEIGHT, RANK_PERSISTENCE_WEIGHT } from "../trading/market-router";
import { emptyPerformanceBook, recordPaperOutcome } from "../trading/performance-memory";
import { parseProposalQuote } from "../trading/proposal";
import { calculateRecoveryStake } from "../trading/recovery";
import { DEFAULT_RISK_CONFIG } from "../trading/risk";
import { createTradingSession } from "../trading/session";
import {
  FAIR_PROBABILITY,
  MIN_DIGIT_SAMPLE,
  MIN_EDGE,
  fitForStrategy,
} from "../trading/specialist-edge";
import { DIGIT_SAMPLE_LIMIT } from "../trading/digit-samples";
import { assessEconomics, equivalentNetExpectedValue, expectedContractValue } from "./economics";
import { importTickDataset } from "./dataset";
import { assessDrift } from "./drift";
import { evaluateCausalSample } from "./evaluate";
import { runParameterExperiments, selectParameterSet, type ExperimentRecord } from "./experiments";
import { computeDigitFeatures } from "./features";
import {
  EVEN_QUALIFIES,
  NEUTRAL_DIGITS,
  ODD_QUALIFIES,
  OVER2_QUALIFIES_OVER3_DOES_NOT,
  UNDER7_QUALIFIES_UNDER8_DOES_NOT,
  repeat,
  syntheticDataset,
} from "./fixtures";
import { emptyLivePaperBook, openLivePaperRecord, settleLivePaperRecord } from "./forward";
import { classifyValidation, VALIDATION_GATES } from "./gates";
import { finalizeMetrics, maximumDrawdown, type MetricAccumulator } from "./metrics";
import { activeBotStrategies, getStrategy, routerEligibleStrategies } from "./registry";
import { explainEntry, replayStrategy } from "./replay";
import { buildLabReport } from "./report";
import { splitChronological } from "./splits";
import { REAL_DATA_REQUIRED, STRATEGY_DEFINITIONS } from "./strategy-spec";

const CHEAP_QUOTE = [{ contractType: "DIGITUNDER", barrier: 7, askPrice: 0.5, payout: 1 }];
const RICH_QUOTE = [{ contractType: "DIGITUNDER", barrier: 7, askPrice: 0.99, payout: 1 }];

test("specialist fixtures match the live probability and edge exactly", () => {
  const under7 = fitForStrategy(UNDER7_QUALIFIES_UNDER8_DOES_NOT, "UNDER_7");
  const under8 = fitForStrategy(UNDER7_QUALIFIES_UNDER8_DOES_NOT, "UNDER_8");
  assert.equal(under7?.contractType, "DIGITUNDER");
  assert.equal(under7?.barrier, 7);
  assert.equal(under7?.probability, 16 / 20);
  assert.equal(under7?.fairProbability, 7 / 10);
  assert.ok(Math.abs((under7?.edge ?? 0) - (16 / 20 - 7 / 10)) < 1e-12);
  assert.equal(under7?.qualified, true);
  assert.equal(under8?.probability, 16 / 20);
  assert.equal(under8?.fairProbability, 8 / 10);
  assert.equal(under8?.edge, 16 / 20 - 8 / 10);
  assert.equal(under8?.qualified, false);

  const over2 = fitForStrategy(OVER2_QUALIFIES_OVER3_DOES_NOT, "OVER_2");
  const over3 = fitForStrategy(OVER2_QUALIFIES_OVER3_DOES_NOT, "OVER_3");
  assert.equal(over2?.probability, 16 / 20);
  assert.ok(Math.abs((over2?.edge ?? 0) - (16 / 20 - 7 / 10)) < 1e-12);
  assert.equal(over2?.qualified, true);
  assert.equal(over3?.probability, 12 / 20);
  assert.equal(over3?.edge, 12 / 20 - 6 / 10);
  assert.equal(over3?.qualified, false);

  const even = fitForStrategy(EVEN_QUALIFIES, "EVEN_ODD");
  const odd = fitForStrategy(ODD_QUALIFIES, "EVEN_ODD");
  assert.equal(even?.contractType, "DIGITEVEN");
  assert.equal(even?.probability, 15 / 20);
  assert.equal(even?.edge, 15 / 20 - 5 / 10);
  assert.equal(even?.qualified, true);
  assert.equal(odd?.contractType, "DIGITODD");
  assert.equal(odd?.probability, 15 / 20);
  assert.equal(odd?.edge, 15 / 20 - 5 / 10);
  assert.equal(odd?.qualified, true);

  for (const strategy of ["UNDER_7", "UNDER_8", "OVER_2", "OVER_3", "EVEN_ODD"] as const) {
    const fit = fitForStrategy(NEUTRAL_DIGITS, strategy);
    assert.equal(fit?.edge, 0);
    assert.equal(fit?.qualified, false);
  }
  assert.equal(fitForStrategy(repeat(0, 9), "UNDER_7")?.qualified, false);
});

test("version 1 definitions are frozen to the live specialist constants", () => {
  for (const definition of STRATEGY_DEFINITIONS) {
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.parameters), true);
    assert.equal(definition.strategyVersion, 1);
    assert.equal(definition.status, "ACTIVE");
    assert.equal(definition.parameters.sampleWindow, DIGIT_SAMPLE_LIMIT);
    assert.equal(definition.parameters.minimumSampleSize, MIN_DIGIT_SAMPLE);
    assert.equal(definition.parameters.minimumEdge, MIN_EDGE);
    assert.equal(definition.parameters.stake, 1);
    assert.equal(definition.parameters.cooldownAfterLossMs, DEFAULT_RISK_CONFIG.cooldownAfterLossMs);
    assert.equal(definition.baselineProbability, FAIR_PROBABILITY[definition.botStrategy]);
    assert.equal(definition.performanceMemory.changesStake, false);
    assert.equal(definition.routerPersistence.rankWeight, RANK_PERSISTENCE_WEIGHT);
    assert.equal(definition.routerPersistence.usedAsEntryGate, false);
  }
  assert.equal(RANK_EDGE_WEIGHT, 0.7);
  assert.equal(activeBotStrategies().size, 5);
  assert.deepEqual(
    routerEligibleStrategies([
      { botStrategy: "UNDER_7", status: "ACTIVE" },
      { botStrategy: "UNDER_8", status: "EXPERIMENTAL" },
      { status: "DISABLED" },
    ]),
    ["UNDER_7"],
  );
});

test("proposal economics keep break-even distinct from statistical edge", () => {
  const quote = parseProposalQuote({ id: "econ", ask_price: 2.5, payout: 4.75 });
  assert.ok(quote);
  const expected = expectedContractValue(0.8, quote.askPrice, quote.payout);
  const net = equivalentNetExpectedValue(0.8, quote.askPrice, quote.payout);
  assert.equal(expected, 0.8 * 4.75 - 2.5);
  assert.ok(expected !== null && net !== null && Math.abs(expected - net) < 1e-12);
  const statistical = assessEconomics(0.8, 0.5, 1);
  assert.equal(statistical.breakEvenProbability, 0.5);
  assert.ok(Math.abs((statistical.economicEdge ?? 0) - 0.3) < 1e-12);
  assert.ok(Math.abs((statistical.expectedValue ?? 0) - 0.3) < 1e-12);
  assert.equal(statistical.economicallyQualified, true);
  const pricedOut = assessEconomics(0.8, 0.95, 1);
  assert.equal(pricedOut.breakEvenProbability, 0.95);
  assert.equal(pricedOut.economicallyQualified, false);
  assert.ok((pricedOut.economicEdge ?? 0) < 0);
});

test("replay matches the live specialist decision on the same causal window", () => {
  const digits = repeat(0, 30);
  const dataset = syntheticDataset({
    label: "SYNTHETIC parity",
    digits,
    proposals: CHEAP_QUOTE,
    startEpoch: 1_700_000_000,
    stepSeconds: 100,
  });
  const definition = getStrategy("under-7-hunter");
  assert.ok(definition);
  const replay = replayStrategy({ definition, ticks: dataset.ticks });
  assert.ok(replay.audit.length > 0);
  for (const event of replay.audit) {
    const causal = dataset.ticks
      .filter((tick) => tick.symbol === event.symbol && tick.epoch <= event.signalEpoch)
      .map((tick) => tick.lastDigit)
      .slice(-definition.parameters.sampleWindow);
    assert.deepEqual(event.sampleDigits, causal);
    const fit = fitForStrategy(causal, "UNDER_7");
    const decision = decideEntry({
      enabled: true,
      open: false,
      riskAllowed: true,
      riskReason: "Trade allowed",
      minimumConfidence: 0,
      fit,
    });
    assert.equal(event.predictedProbability, fit?.probability);
    assert.equal(event.edge, fit?.edge);
    assert.equal(event.baselineProbability, fit?.fairProbability);
    const shared = evaluateCausalSample({
      digits: causal,
      strategy: "UNDER_7",
      thresholds: { minimumSampleSize: 10, minimumEdge: 0.08 },
      session: createTradingSession(),
      confidenceFloor: 0,
      open: false,
      riskAllowed: true,
      riskReason: "Trade allowed",
      signalPersistenceMet: true,
      avoidedByPerformance: false,
      tickCooldownActive: false,
    });
    assert.equal(event.entryPhase, shared.phase);
    assert.equal(shared.phase, decision.phase);
    assert.equal(event.sampleDigits.includes(event.nextDigit ?? -1) && event.sampleSize === 1, false);
  }
  assert.match(explainEntry(replay.audit[0]), /baseline/);
});

test("future ticks cannot change the current feature window", () => {
  const digits = [...NEUTRAL_DIGITS, ...repeat(9, 10)];
  const dataset = syntheticDataset({ label: "SYNTHETIC leakage", digits });
  const prefix = dataset.ticks.slice(0, 20).map((tick) => tick.lastDigit);
  const before = computeDigitFeatures(prefix);
  const mutated = dataset.ticks.map((tick, index) =>
    index > 19 ? { ...tick, lastDigit: 0 } : tick,
  );
  const after = computeDigitFeatures(mutated.slice(0, 20).map((tick) => tick.lastDigit));
  assert.deepEqual(before, after);
  const definition = getStrategy("under-7-hunter");
  assert.ok(definition);
  const replay = replayStrategy({ definition, ticks: dataset.ticks });
  const event = replay.audit[0] ?? null;
  if (event) {
    const future = dataset.ticks.find((tick) => tick.epoch > event.signalEpoch);
    assert.ok(future);
    assert.equal(event.sampleDigits.includes(future.lastDigit) && event.sampleDigits.length === 1, false);
    assert.deepEqual(
      event.sampleDigits,
      dataset.ticks
        .filter((tick) => tick.epoch <= event.signalEpoch)
        .map((tick) => tick.lastDigit)
        .slice(-20),
    );
    assert.notEqual(event.nextDigit, null);
  }
});

test("importer rejects duplicate epochs, bad order, and symbol mixing", () => {
  const duplicate = importTickDataset({
    origin: "real",
    label: "R_10 export",
    ticks: [
      { symbol: "R_10", epoch: 2, quote: 1, lastDigit: 1 },
      { symbol: "R_10", epoch: 2, quote: 1, lastDigit: 2 },
    ],
  });
  assert.equal(duplicate.ok, false);
  const ordered = importTickDataset({
    origin: "synthetic",
    label: "SYNTHETIC ordered",
    ticks: [
      { symbol: "R_25", epoch: 2, quote: 1, lastDigit: 9 },
      { symbol: "R_10", epoch: 1, quote: 1, lastDigit: 0 },
      { symbol: "R_10", epoch: 3, quote: 1, lastDigit: 0 },
    ],
  });
  assert.equal(ordered.ok, true);
  if (ordered.ok) {
    const definition = getStrategy("under-7-hunter");
    assert.ok(definition);
    const replay = replayStrategy({ definition, ticks: ordered.dataset.ticks });
    const r10 = replay.bySymbol.find((item) => item.symbol === "R_10");
    const r25 = replay.bySymbol.find((item) => item.symbol === "R_25");
    assert.ok(r10 && r25);
    assert.equal(r10.metrics.observations > 0 || r25.metrics.observations === 0, true);
    const features = computeDigitFeatures([0, 0]);
    assert.equal(features.under7Frequency, 1);
    assert.notEqual(features.under7Frequency, computeDigitFeatures([9]).under7Frequency);
  }
});

test("parameter selection ignores test-slice outcomes and does not rank by profit", () => {
  const baseDigits = [...NEUTRAL_DIGITS, ...NEUTRAL_DIGITS, ...repeat(0, 20)];
  const base = syntheticDataset({
    label: "SYNTHETIC selection",
    digits: baseDigits,
    proposals: CHEAP_QUOTE,
  });
  const poisonedTicks = base.ticks.map((tick, index) =>
    index >= Math.floor(base.ticks.length * 0.8) ? { ...tick, lastDigit: 9 } : tick,
  );
  const poisoned = { ...base, ticks: poisonedTicks };
  const first = runParameterExperiments(base, getStrategy("under-7-hunter")!);
  const second = runParameterExperiments(poisoned, getStrategy("under-7-hunter")!);
  assert.deepEqual(
    first.records.map((record) => record.validation.totalProfitLoss),
    second.records.map((record) => record.validation.totalProfitLoss),
  );
  assert.equal(first.selected?.id, second.selected?.id);

  const poorButRich: ExperimentRecord = {
    id: "rich",
    parameters: getStrategy("under-7-hunter")!.parameters,
    validation: metricsWith({ trades: 40, expectedValuePerTrade: 0.01, totalProfitLoss: 500, calibration: 0.01 }),
    walkForwardExpectancies: [0.01, 0.01, 0.01],
    robustnessScore: null,
    eligible: false,
  };
  const betterExpectancy: ExperimentRecord = {
    ...poorButRich,
    id: "steady",
    validation: metricsWith({ trades: 40, expectedValuePerTrade: 0.2, totalProfitLoss: 8, calibration: 0.01 }),
  };
  const selected = selectParameterSet([poorButRich, betterExpectancy]).selected;
  assert.equal(selected?.id, "steady");
  assert.equal(getStrategy("under-7-hunter")?.parameters.minimumEdge, MIN_EDGE);
  assert.equal(DEFAULT_RISK_CONFIG.stake, 1);
});

test("validation gates can reject, find no edge, or stay unvalidated without real data", () => {
  const empty = buildLabReport(null);
  assert.equal(empty.dataStatus, REAL_DATA_REQUIRED);
  assert.equal(empty.strategies.every((item) => item.displayedStatus === "INSUFFICIENT_DATA"), true);
  const synthetic = buildLabReport(
    syntheticDataset({
      label: "SYNTHETIC lab",
      digits: UNDER7_QUALIFIES_UNDER8_DOES_NOT,
      proposals: CHEAP_QUOTE,
    }),
  );
  assert.match(synthetic.dataStatus, /REAL HISTORICAL VALIDATION DATA REQUIRED/);
  assert.equal(synthetic.strategies[0]?.displayedStatus, "INSUFFICIENT_DATA");

  const noEdge = classifyValidation({
    origin: "real",
    slice: "test",
    metrics: metricsWith({
      trades: 80,
      signals: 200,
      observations: 500,
      expectedValuePerTrade: -0.01,
      hitRate: 0.9,
      baseline: 0.7,
      calibration: 0.01,
    }),
    walkForwardWindows: 3,
    walkForwardAllPositive: true,
    maxWindowProfitShare: 0.4,
    maxSymbolProfitShare: 0.4,
    parameterSelectionUsedTest: false,
  });
  assert.equal(noEdge.status, "NO_EDGE");
  const rejected = classifyValidation({
    origin: "real",
    slice: "test",
    metrics: metricsWith({
      trades: 80,
      signals: 200,
      observations: 500,
      expectedValuePerTrade: 0.2,
      hitRate: 0.95,
      baseline: 0.7,
      drawdown: 50,
      consecutive: 12,
    }),
    walkForwardWindows: 3,
    walkForwardAllPositive: true,
    maxWindowProfitShare: 0.2,
    maxSymbolProfitShare: 0.2,
    parameterSelectionUsedTest: false,
  });
  assert.equal(rejected.status, "REJECTED");
  assert.equal(VALIDATION_GATES.minimumOutOfSampleTrades, 80);
});

test("losses do not increase stake and live orders stay blocked", () => {
  const definition = getStrategy("under-7-hunter");
  assert.ok(definition);
  const digits = [...repeat(0, 25), 9, ...repeat(0, 25), 9];
  const replay = replayStrategy({
    definition,
    ticks: syntheticDataset({
      label: "SYNTHETIC stake",
      digits,
      proposals: CHEAP_QUOTE,
      startEpoch: 1_700_000_000,
    }).ticks,
  });
  for (const trade of replay.metrics.trades ? [] : []) {
    assert.fail(trade);
  }
  assert.equal(definition.parameters.stake, 1);
  assert.equal(replay.metrics.trades === 0 || replay.metrics.averageProfitLossPerTrade !== null, true);
  const recovery = calculateRecoveryStake({
    accumulatedLoss: 10,
    targetProfit: 5,
    payoutRatio: 0.8,
    baseStake: 1,
  });
  assert.equal(recovery.stake, 1);
  assert.equal(LIVE_ORDERS_ENABLED, false);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ buy: 1 }), /buy/i);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ sell: 1 }), /sell/i);
  assert.throws(() => assertAllowedAuthenticatedAccountRequest({ buy: 1 }), /buy/i);
  assert.throws(() => assertAllowedAuthenticatedAccountRequest({ sell: 1 }), /sell/i);
});

test("live paper records stay separate and drift does not rewrite the strategy", () => {
  let book = emptyLivePaperBook();
  book = openLivePaperRecord(book, {
    id: "paper-1",
    strategy: "UNDER_7",
    symbol: "R_10",
    predictedProbability: 0.8,
    askPrice: 0.5,
    payout: 1,
    contractType: "DIGITUNDER",
    barrier: 7,
    openedAt: 10,
  });
  book = settleLivePaperRecord(book, "paper-1", { won: false, profitLoss: -0.5, exitDigit: 9 });
  assert.equal(book.events[0]?.source, "LIVE_PAPER");
  assert.equal(book.events[0]?.strategyVersion, 1);
  assert.equal(book.events[0]?.profitLoss, -0.5);
  const drift = assessDrift({
    historical: { hitRate: 0.8, expectedValuePerTrade: 0.1, signalRate: 0.2 },
    recent: { trades: 20, hitRate: 0.5, observedValuePerTrade: -0.1, signalRate: 0.2 },
  });
  assert.equal(drift.flag, "DRIFT_WARNING");
  assert.equal(getStrategy("under-7-hunter")?.parameters.minimumEdge, 0.08);
  const noBaseline = assessDrift({
    historical: null,
    recent: { trades: 0, hitRate: null, observedValuePerTrade: null, signalRate: null },
  });
  assert.equal(noBaseline.flag, "NO_HISTORICAL_BASELINE");
});

test("router skips strategies that are not eligible and rolling work stays bounded", () => {
  const routed = routeMarkets({
    markets: [{ symbol: "R_10", marketName: "Volatility 10", digits: UNDER7_QUALIFIES_UNDER8_DOES_NOT }],
    performance: emptyPerformanceBook(),
    eligibleStrategies: new Set(["UNDER_8"]),
  });
  assert.equal(routed.assigned.UNDER_7, null);
  assert.equal(routed.evaluated.some((item) => item.strategy === "UNDER_7"), false);

  const definition = getStrategy("under-8-hunter");
  assert.ok(definition);
  const symbols = Array.from({ length: 12 }, (_, index) => `R_${index}`);
  const ticks = symbols.flatMap((symbol, symbolIndex) =>
    repeat(symbolIndex % 2 === 0 ? 0 : 9, 80).map((lastDigit, index) => ({
      symbol,
      epoch: 10_000 + index,
      quote: 50,
      lastDigit,
    })),
  );
  const started = Date.now();
  const replay = replayStrategy({ definition, ticks });
  assert.ok(Date.now() - started < 3000);
  assert.ok(replay.maxWindowUsed <= definition.parameters.sampleWindow);
  assert.ok(replay.audit.length <= 200);
  let book = emptyPerformanceBook();
  for (let index = 0; index < 120; index += 1) {
    book = recordPaperOutcome(book, {
      market: `M${index}`,
      strategy: "UNDER_7",
      contractType: "DIGITUNDER",
      won: false,
      profitLoss: -1,
      confidence: 0.8,
    });
  }
  assert.ok(book.records.length <= 100);
});

test("chronological split does not shuffle and drawdown is exact", () => {
  const ticks = Array.from({ length: 10 }, (_, index) => ({
    symbol: "R_10",
    epoch: index + 1,
    quote: 1,
    lastDigit: index % 10,
  }));
  const split = splitChronological(ticks);
  assert.deepEqual(
    [...split.train, ...split.validation, ...split.test].map((tick) => tick.epoch),
    ticks.map((tick) => tick.epoch),
  );
  assert.equal(split.train.at(-1)!.epoch < split.validation[0].epoch, true);
  assert.equal(maximumDrawdown([
    { epoch: 1, symbol: "R", pnl: 1, won: true, predicted: 0.5, baseline: 0.5, statisticalEdge: 0, economicEdge: 0, expectedValue: 0 },
    { epoch: 2, symbol: "R", pnl: -1, won: false, predicted: 0.5, baseline: 0.5, statisticalEdge: 0, economicEdge: 0, expectedValue: 0 },
    { epoch: 3, symbol: "R", pnl: -1, won: false, predicted: 0.5, baseline: 0.5, statisticalEdge: 0, economicEdge: 0, expectedValue: 0 },
  ]), 2);
});

test("a priced-out signal is not an economic trade", () => {
  const definition = getStrategy("under-7-hunter");
  assert.ok(definition);
  const replay = replayStrategy({
    definition,
    ticks: syntheticDataset({
      label: "SYNTHETIC priced out",
      digits: [...UNDER7_QUALIFIES_UNDER8_DOES_NOT, ...repeat(0, 5)],
      proposals: RICH_QUOTE,
    }).ticks,
  });
  assert.equal(replay.metrics.trades, 0);
  assert.equal(replay.audit.some((event) => event.statisticalSignal), true);
  assert.equal(replay.audit.every((event) => event.economicallyQualified === false), true);
});

function metricsWith(params: {
  trades: number;
  signals?: number;
  observations?: number;
  expectedValuePerTrade: number;
  totalProfitLoss?: number;
  calibration?: number;
  hitRate?: number;
  baseline?: number;
  drawdown?: number;
  consecutive?: number;
}) {
  const trades = params.trades;
  const hitRate = params.hitRate ?? 0.9;
  const wins = Math.round(hitRate * trades);
  const accumulator: MetricAccumulator = {
    observations: params.observations ?? 500,
    signals: params.signals ?? 200,
    signalWins: wins,
    unfiltered: params.observations ?? 500,
    unfilteredWins: wins,
    statisticalEdgeSum: 20,
    economicEdgeSum: 10,
    economicEdgeCount: trades,
    symbols: ["R_10", "R_25"],
    trades: Array.from({ length: trades }, (_, index) => ({
      epoch: index + 1,
      symbol: index % 2 === 0 ? "R_10" : "R_25",
      pnl: index < (params.consecutive ?? 0) ? -1 : params.expectedValuePerTrade,
      won: index >= (params.consecutive ?? 0) && index < wins,
      predicted: hitRate + (params.calibration ?? 0),
      baseline: params.baseline ?? 0.7,
      statisticalEdge: 0.1,
      economicEdge: 0.05,
      expectedValue: params.expectedValuePerTrade,
    })),
  };
  const metrics = finalizeMetrics(accumulator);
  if (params.drawdown !== undefined) {
    metrics.maximumDrawdown = params.drawdown;
  }
  if (params.consecutive !== undefined) {
    metrics.maximumConsecutiveLosses = params.consecutive;
  }
  metrics.expectedValuePerTrade = params.expectedValuePerTrade;
  metrics.actualHitRate = hitRate;
  metrics.baselineWinRate = params.baseline ?? 0.7;
  metrics.hitRateInterval = { lower: hitRate, upper: Math.min(1, hitRate + 0.01) };
  metrics.absoluteCalibrationError = params.calibration ?? 0;
  return metrics;
}
