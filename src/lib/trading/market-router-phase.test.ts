import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertAllowedAuthenticatedAccountRequest } from "../deriv/auth/request-guard";
import {
  MAX_LIVE_TICK_STREAMS,
} from "../deriv/constants";
import { assertAllowedPublicMarketDataRequest } from "../deriv/public-request-guard";
import {
  activeSymbols,
  emptySubscriptionLedger,
  releaseConsumer,
  releaseOwner,
  requiredSubscriptionSymbols,
  retainConsumer,
  setOwnerSymbols,
} from "../deriv/subscription-ledger";
import type { DerivActiveSymbol } from "../deriv/types";
import { createPaperTrade } from "./paper-engine";
import { DIGIT_SAMPLE_LIMIT, emptyDigitSamples, recordDigitSample } from "./digit-samples";
import { LIVE_ORDERS_ENABLED } from "./live-orders";
import {
  discoverEligibleMarkets,
  knownDigitContracts,
  parseDigitContracts,
  unknownDigitContracts,
} from "./market-universe";
import { rankingScore, routeMarkets } from "./market-router";
import {
  MAX_PERFORMANCE_BONUS,
  MAX_PERFORMANCE_PENALTY,
  emptyPerformanceBook,
  performanceAdjustment,
  recordPaperOutcome,
} from "./performance-memory";
import {
  commitOpenPosition,
  emptyPaperBook,
  settleSymbolPosition,
  type TrackedPaperPosition,
} from "./paper-book";
import { calculateRecoveryStake, getRecoveryDecision } from "./recovery";
import { canPlaceTrade, DEFAULT_RISK_CONFIG } from "./risk";
import {
  evaluateAssignmentEntries,
  mayOpenPaperTrade,
  routerCannotExecute,
} from "./run-cycle";
import { createTradingSession } from "./session";
import { evaluateSpecialists } from "./specialist-edge";
import {
  blockArmedEntries,
  createRuntimeState,
  dispatchRuntime,
  entriesAllowed,
  paperEntryPermitted,
} from "./runtime-session";
import { openArmedPaperTrade } from "./armed-paper-trade";
import { openControlledPaperTrade } from "./controller";
import { parseProposalQuote } from "./proposal";

const under8Sample = [0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 7, 7, 7, 7, 7, 7, 7, 7, 9, 9];
const over3Sample = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];
const shortSpike = [0, 0, 0];

function symbol(code: string, extras: Partial<DerivActiveSymbol> = {}): DerivActiveSymbol {
  return {
    underlying_symbol: code,
    underlying_symbol_name: code,
    market: "synthetic_index",
    submarket: "random_index",
    exchange_is_open: 1,
    is_trading_suspended: 0,
    category: "synthetic_index",
    ...extras,
  };
}

function market(
  code: string,
  digits: number[],
  contracts = knownDigitContracts(),
) {
  return {
    symbol: code,
    marketName: code,
    digits,
    contracts,
  };
}

function position(
  code: string,
  strategy: TrackedPaperPosition["strategy"],
  contractType: string,
  proposalId: string,
  epoch: number,
  barrier?: number,
): TrackedPaperPosition {
  const trade = createPaperTrade({
    strategy,
    symbol: code,
    contractType,
    barrier,
    stake: 1,
    quotedPayout: 1.8,
    entryDigit: 4,
  });
  return {
    ...trade,
    proposalId,
    entryEpoch: epoch,
    runtimeSessionId: "paper-session",
    signalKey: `${code}|${strategy}|${epoch}`,
    confidence: 0.9,
  };
}

test("discovery uses the full eligible synthetic universe and not the first 16", () => {
  const synthetics = Array.from({ length: 20 }, (_, index) => symbol(`R_${index + 1}`));
  const mixed = [
    ...synthetics,
    symbol("frxEURUSD", { market: "forex", category: "forex", submarket: "major_pairs" }),
    symbol("cryBTC", { market: "cryptocurrency", category: "cryptocurrency" }),
    symbol("BOOM1000", { submarket: "boom_index" }),
    symbol("CRASH1000", { submarket: "crash_index" }),
    symbol("1HZ50V", { submarket: "random_index" }),
    symbol("R_CLOSED", { exchange_is_open: 0 }),
    symbol("R_HALTED", { is_trading_suspended: 1 }),
    symbol("R_FOREX_LABEL", { market: "forex" }),
  ];
  const discovered = discoverEligibleMarkets(mixed);
  assert.equal(discovered.length, 23);
  assert.equal(discovered.some((item) => item.symbol === "frxEURUSD"), false);
  assert.equal(discovered.some((item) => item.symbol === "cryBTC"), false);
  assert.equal(discovered.some((item) => item.symbol === "R_CLOSED"), false);
  assert.equal(discovered.some((item) => item.symbol === "R_HALTED"), false);
  assert.equal(discovered.some((item) => item.symbol === "R_FOREX_LABEL"), false);
  assert.equal(discovered.some((item) => item.symbol === "BOOM1000"), true);
  assert.equal(discovered.some((item) => item.symbol === "1HZ50V"), true);
  assert.equal(discovered.some((item) => item.symbol === "R_17"), true);
  assert.deepEqual(
    discovered.map((item) => item.symbol),
    [...discovered.map((item) => item.symbol)].sort(),
  );

  const view = readFileSync(new URL("../../../components/bots/BotMonitorView.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../deriv/public-market-data.ts", import.meta.url), "utf8");
  assert.equal(view.includes("MASTER_STREAM_LIMIT"), false);
  assert.equal(/slice\(\s*0\s*,\s*16\s*\)/.test(view), false);
  assert.equal(client.includes("setTickSubscriptions(this.desiredSymbols)"), false);
});

test("unsupported digit contracts fail closed", () => {
  const parsed = parseDigitContracts({
    available: [{ contract_type: "CALL" }, { contract_type: "PUT" }],
  });
  assert.equal(parsed.status, "unsupported");
  const routed = routeMarkets({
    markets: [market("BOOM1000", over3Sample, parsed)],
    performance: emptyPerformanceBook(),
  });
  assert.equal(routed.evaluated.length, 5);
  assert.equal(routed.ranked.length, 0);
  assert.equal(routed.assignments.BOOM1000, undefined);
  assert.equal(routed.evaluated.every((item) => item.contractAvailable === false), true);

  const unknown = routeMarkets({
    markets: [market("R_75", over3Sample, unknownDigitContracts())],
    performance: emptyPerformanceBook(),
  });
  assert.equal(unknown.ranked.length, 0);

  const partial = parseDigitContracts({
    available: [
      {
        contract_type: "DIGITUNDER",
        barriers: 1,
        last_digit_range: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      },
      { contract_type: "DIGITEVEN", barriers: 0 },
    ],
  });
  const limited = routeMarkets({
    markets: [market("R_50", under8Sample, partial)],
    performance: emptyPerformanceBook(),
  });
  assert.equal(limited.assignments.R_50?.strategy, "UNDER_8");
  assert.equal(
    limited.ranked.some((item) => item.strategy === "OVER_3" || item.strategy === "EVEN_ODD"),
    false,
  );

  const countedAsRange = parseDigitContracts({
    available: [
      {
        contract_type: "DIGITOVER",
        barriers: 1,
        last_digit_range: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      },
    ],
  });
  const over = routeMarkets({
    markets: [market("R_100", over3Sample, countedAsRange)],
    performance: emptyPerformanceBook(),
  });
  assert.equal(over.assignments.R_100?.strategy, "OVER_3");
  assert.equal(over.assignments.R_100?.contractAvailable, true);
});

test("digit histories stay isolated, ignore duplicate epochs, and stay bounded", () => {
  let book = emptyDigitSamples();
  const first = recordDigitSample(book, "R_75", 10, 1);
  book = first.book;
  const duplicate = recordDigitSample(book, "R_75", 10, 9);
  assert.equal(duplicate.accepted, false);
  assert.deepEqual(duplicate.history, [1]);
  const other = recordDigitSample(duplicate.book, "R_100", 10, 4);
  assert.deepEqual(other.book.digits.R_75, [1]);
  assert.deepEqual(other.book.digits.R_100, [4]);

  let rolling = emptyDigitSamples();
  for (let epoch = 1; epoch <= DIGIT_SAMPLE_LIMIT + 5; epoch += 1) {
    rolling = recordDigitSample(rolling, "R_75", epoch, epoch % 10).book;
  }
  assert.equal(rolling.digits.R_75.length, DIGIT_SAMPLE_LIMIT);
  assert.equal(rolling.digits.R_100, undefined);
});

test("router evaluates every specialist, qualifies before ranking, and stays deterministic", () => {
  const noisy = market("R_10", shortSpike);
  const modest = market("R_75", under8Sample);
  const strong = market("R_100", over3Sample);
  const first = routeMarkets({
    markets: [noisy, modest, strong],
    performance: emptyPerformanceBook(),
  });
  const second = routeMarkets({
    markets: [noisy, modest, strong],
    performance: emptyPerformanceBook(),
  });
  assert.equal(first.evaluated.filter((item) => item.symbol === "R_75").length, 5);
  assert.deepEqual(
    first.evaluated.filter((item) => item.symbol === "R_75").map((item) => item.strategy).sort(),
    ["EVEN_ODD", "OVER_2", "OVER_3", "UNDER_7", "UNDER_8"],
  );
  assert.equal(first.ranked.some((item) => item.symbol === "R_10"), false);
  assert.equal(first.ranked[0]?.symbol, "R_100");
  assert.equal(first.ranked[0]?.strategy, "OVER_3");
  assert.equal(first.ranked[0]?.rank, 1);
  assert.equal(first.assignments.R_100?.strategy, "OVER_3");
  assert.equal(first.assignments.R_75?.strategy, "UNDER_8");
  assert.ok((first.ranked[0]?.rankScore ?? 0) >= (first.ranked[1]?.rankScore ?? 0));
  assert.deepEqual(
    first.ranked.map((item) => [item.symbol, item.strategy, item.rankScore]),
    second.ranked.map((item) => [item.symbol, item.strategy, item.rankScore]),
  );
  assert.equal(routerCannotExecute(), false);
  assert.equal(mayOpenPaperTrade({
    role: "router",
    entryPhase: "ARMED",
    liveOrdersEnabled: false,
    runtimePhase: "RUNNING",
  }), false);
});

test("a cooled-down pair is excluded and performance adjustment stays bounded", () => {
  let book = emptyPerformanceBook();
  book = recordPaperOutcome(book, {
    market: "R_75",
    strategy: "UNDER_8",
    contractType: "DIGITUNDER",
    barrier: 8,
    won: false,
    profitLoss: -1,
    confidence: 0.9,
  });
  book = recordPaperOutcome(book, {
    market: "R_75",
    strategy: "UNDER_8",
    contractType: "DIGITUNDER",
    barrier: 8,
    won: false,
    profitLoss: -1,
    confidence: 0.9,
  });
  const routed = routeMarkets({
    markets: [market("R_75", under8Sample), market("R_100", under8Sample)],
    performance: book,
  });
  assert.equal(
    routed.ranked.some((item) => item.symbol === "R_75" && item.strategy === "UNDER_8"),
    false,
  );
  assert.notEqual(routed.assignments.R_75?.strategy, "UNDER_8");
  assert.equal(routed.assignments.R_100?.strategy, "UNDER_8");

  let learned = emptyPerformanceBook();
  for (let index = 0; index < 4; index += 1) {
    learned = recordPaperOutcome(learned, {
      market: "R_75",
      strategy: "UNDER_8",
      contractType: "DIGITUNDER",
      barrier: 8,
      won: true,
      profitLoss: 0.8,
      confidence: 0.9,
    });
  }
  const bonus = performanceAdjustment(learned, "R_75", "UNDER_8");
  assert.equal(bonus, MAX_PERFORMANCE_BONUS);
  assert.ok(bonus <= MAX_PERFORMANCE_BONUS);
  assert.ok(bonus >= -MAX_PERFORMANCE_PENALTY);
  assert.equal(performanceAdjustment(learned, "R_100", "UNDER_8"), 0);
  assert.equal(performanceAdjustment(learned, "R_75", "OVER_3"), 0);
  const flat = routeMarkets({
    markets: [market("R_75", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])],
    performance: learned,
  });
  assert.equal(flat.ranked.length, 0);
  assert.equal(
    rankingScore({
      qualified: false,
      edge: 0.9,
      sampleSize: 3,
      persistence: 1,
      performanceAdjustment: MAX_PERFORMANCE_BONUS,
    }),
    Number.NEGATIVE_INFINITY,
  );
});

test("each symbol has an independent entry and the router cannot bypass it", () => {
  const routed = routeMarkets({
    markets: [market("R_75", under8Sample), market("R_100", over3Sample)],
    performance: emptyPerformanceBook(),
  });
  const entries = evaluateAssignmentEntries({
    assignments: routed.assignments,
    digits: { R_75: under8Sample, R_100: over3Sample },
    openSymbols: new Set(["R_75"]),
    phase: "RUNNING",
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0,
  });
  assert.equal(entries.R_75.phase, "PAPER_TRADE_OPEN");
  assert.equal(entries.R_75.armed, false);
  assert.equal(entries.R_100.phase, "ARMED");
  assert.equal(mayOpenPaperTrade({
    role: "specialist",
    entryPhase: entries.R_75.phase,
    liveOrdersEnabled: false,
    runtimePhase: "RUNNING",
  }), false);
  assert.equal(mayOpenPaperTrade({
    role: "specialist",
    entryPhase: entries.R_100.phase,
    liveOrdersEnabled: false,
    runtimePhase: "RUNNING",
  }), true);
  assert.equal(mayOpenPaperTrade({
    role: "router",
    entryPhase: "ARMED",
    liveOrdersEnabled: false,
    runtimePhase: "RUNNING",
  }), false);
});

test("different symbols can be open together and the same symbol cannot", () => {
  let book = emptyPaperBook();
  const first = commitOpenPosition(book, position("R_75", "UNDER_8", "DIGITUNDER", "p-75", 10, 8));
  assert.equal(first.accepted, true);
  book = first.book;
  const second = commitOpenPosition(book, position("R_100", "OVER_3", "DIGITOVER", "p-100", 11, 3));
  assert.equal(second.accepted, true);
  book = second.book;
  assert.equal(book.open.R_75.strategy, "UNDER_8");
  assert.equal(book.open.R_100.strategy, "OVER_3");
  const duplicate = commitOpenPosition(
    book,
    position("R_75", "UNDER_7", "DIGITUNDER", "p-75b", 12, 7),
  );
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.book.open.R_75.proposalId, "p-75");
  const sameProposal = commitOpenPosition(
    book,
    position("1HZ50V", "OVER_2", "DIGITOVER", "p-75", 13, 2),
  );
  assert.equal(sameProposal.accepted, false);
});

test("parallel proposal attempts cannot create two positions for one symbol", async () => {
  const inFlight: Record<string, boolean> = {};
  let release: (proposal: { id: string; ask_price: number; payout: number }) => void = () => {};
  const pending = new Promise<{ id: string; ask_price: number; payout: number }>((resolve) => {
    release = resolve;
  });
  const fit = evaluateSpecialists(under8Sample).find((item) => item.strategy === "UNDER_8");
  assert.ok(fit);
  let commits = 0;
  const first = openArmedPaperTrade({
    client: { requestProposal: () => pending },
    symbol: "R_75",
    fit,
    session: createTradingSession(),
    currency: "USD",
    targetProfit: 0.1,
    inFlight,
    accept: () => {
      commits += 1;
      return true;
    },
  });
  const raced = await openArmedPaperTrade({
    client: {
      requestProposal: async () => ({ id: "should-not-run", ask_price: 1, payout: 1.8 }),
    },
    symbol: "R_75",
    fit,
    session: createTradingSession(),
    currency: "USD",
    targetProfit: 0.1,
    inFlight,
  });
  assert.equal(raced, null);
  release({ id: "p-race", ask_price: 1, payout: 1.8 });
  const opened = await first;
  assert.equal(opened?.symbol, "R_75");
  assert.equal(commits, 1);
  assert.equal(inFlight.R_75, false);
});

test("settlement follows the position symbol and ignores duplicates", () => {
  let book = emptyPaperBook();
  book = commitOpenPosition(book, position("R_75", "UNDER_8", "DIGITUNDER", "p-75", 10, 8)).book;
  book = commitOpenPosition(book, position("R_100", "OVER_3", "DIGITOVER", "p-100", 10, 3)).book;
  let session = createTradingSession();

  const wrong = settleSymbolPosition(book, session, "R_75", 3, 10);
  assert.equal(wrong.settled, false);
  assert.equal(wrong.book.open.R_100.status, "OPEN");

  const r75 = settleSymbolPosition(book, session, "R_75", 9, 11);
  assert.equal(r75.settled, true);
  assert.equal(r75.trade?.symbol, "R_75");
  assert.equal(r75.trade?.status, "LOST");
  assert.equal(r75.book.open.R_100.status, "OPEN");
  session = r75.session;
  book = r75.book;

  const again = settleSymbolPosition(book, session, "R_75", 1, 12);
  assert.equal(again.settled, false);
  assert.equal(again.session.profitLoss, session.profitLoss);

  const r100 = settleSymbolPosition(book, session, "R_100", 9, 12);
  assert.equal(r100.settled, true);
  assert.equal(r100.trade?.symbol, "R_100");
  assert.equal(r100.trade?.status, "WON");
  assert.equal(r100.book.open.R_75, undefined);
  assert.equal(r100.book.open.R_100, undefined);
  assert.equal(r100.session.profitLoss, -1 + 0.8);
  assert.equal(r100.session.totalTrades, 2);
});

test("session loss counts every settled position and losses do not raise stake", () => {
  let book = emptyPaperBook();
  book = commitOpenPosition(book, position("R_75", "UNDER_7", "DIGITUNDER", "a", 1, 7)).book;
  book = commitOpenPosition(book, position("R_100", "UNDER_7", "DIGITUNDER", "b", 1, 7)).book;
  let session = createTradingSession();
  const first = settleSymbolPosition(book, session, "R_75", 9, 2);
  const second = settleSymbolPosition(first.book, first.session, "R_100", 8, 2);
  assert.equal(second.session.profitLoss, -2);
  assert.equal(second.session.losses, 2);
  const blocked = canPlaceTrade(
    second.session,
    { ...DEFAULT_RISK_CONFIG, maxSessionLoss: 2 },
    1_000,
    0,
  );
  assert.equal(blocked.allowed, false);

  const nearCap = canPlaceTrade(
    { ...createTradingSession(), totalTrades: 49 },
    DEFAULT_RISK_CONFIG,
    1_000,
    1,
  );
  assert.equal(nearCap.allowed, false);
  assert.equal(DEFAULT_RISK_CONFIG.maxTradesPerSession, 50);

  const quote = parseProposalQuote({ id: "stake", ask_price: 1, payout: 1.8 });
  assert.ok(quote);
  const opened = openControlledPaperTrade(
    second.session,
    {
      strategy: "OVER_3",
      symbol: "1HZ50V",
      contractType: "DIGITOVER",
      barrier: 3,
      entryDigit: 8,
      confidence: 0.9,
      quote,
      targetProfit: 1,
    },
    { ...DEFAULT_RISK_CONFIG, maxSessionLoss: 10, cooldownAfterLossMs: 0 },
  );
  assert.equal(opened.trade?.stake, DEFAULT_RISK_CONFIG.stake);
  const recovery = calculateRecoveryStake({
    accumulatedLoss: 50,
    targetProfit: 10,
    payoutRatio: quote.payoutRatio,
    baseStake: DEFAULT_RISK_CONFIG.stake,
  });
  assert.equal(recovery.stake, DEFAULT_RISK_CONFIG.stake);
  assert.equal(getRecoveryDecision(second.session).stakeMultiplier, 1);
});

test("subscriptions share one ledger, avoid duplicates, and restore without dropping other consumers", () => {
  let ledger = emptySubscriptionLedger();
  const symbols = Array.from({ length: 20 }, (_, index) => `R_${index + 1}`);
  ledger = setOwnerSymbols(ledger, "bot-monitor", symbols, 2);
  ledger = setOwnerSymbols(ledger, "scanner", ["R_1", "R_2"], 1);
  ledger = retainConsumer(ledger, "R_100");
  ledger = retainConsumer(ledger, "R_100");
  const active = requiredSubscriptionSymbols(ledger, MAX_LIVE_TICK_STREAMS);
  assert.equal(active.length, 21);
  assert.equal(active.filter((symbol) => symbol === "R_1").length, 1);
  assert.equal(active.includes("R_17"), true);
  ledger = releaseConsumer(ledger, "R_100");
  assert.equal(activeSymbols(ledger, MAX_LIVE_TICK_STREAMS).includes("R_100"), true);
  ledger = releaseConsumer(ledger, "R_100");
  assert.equal(activeSymbols(ledger, MAX_LIVE_TICK_STREAMS).includes("R_100"), false);
  assert.equal(activeSymbols(ledger, MAX_LIVE_TICK_STREAMS).includes("R_2"), true);
  const restored = requiredSubscriptionSymbols(ledger, MAX_LIVE_TICK_STREAMS);
  assert.deepEqual(restored, activeSymbols(ledger, MAX_LIVE_TICK_STREAMS));
  ledger = releaseOwner(ledger, "scanner");
  assert.equal(requiredSubscriptionSymbols(ledger, MAX_LIVE_TICK_STREAMS).includes("R_17"), true);
  ledger = releaseOwner(ledger, "bot-monitor");
  assert.deepEqual(requiredSubscriptionSymbols(ledger, MAX_LIVE_TICK_STREAMS), []);
});

test("pause, cooldown, and emergency stop block new entries while settlement still works", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, 5_000).state;
  const paused = dispatchRuntime(running, "PAUSE", 2_000, 5_000).state;
  assert.equal(entriesAllowed(paused.phase), false);
  assert.equal(paperEntryPermitted(paused.phase, "ARMED", false), false);
  assert.equal(blockArmedEntries(paused.phase, { phase: "ARMED", armed: true, reason: "ready" }).armed, false);

  let book = emptyPaperBook();
  book = commitOpenPosition(book, position("R_75", "UNDER_8", "DIGITUNDER", "pause-75", 4, 8)).book;
  book = commitOpenPosition(book, position("R_100", "OVER_3", "DIGITOVER", "pause-100", 4, 3)).book;
  const settled = settleSymbolPosition(book, createTradingSession(), "R_75", 1, 5);
  assert.equal(settled.settled, true);
  assert.equal(settled.book.open.R_100.status, "OPEN");

  const cooled = dispatchRuntime(running, "COOLDOWN", 3_000, 5_000).state;
  assert.equal(paperEntryPermitted(cooled.phase, "ARMED", false), false);
  const stopped = dispatchRuntime(running, "EMERGENCY_STOP", 4_000, 5_000).state;
  assert.equal(entriesAllowed(stopped.phase), false);
  assert.equal(mayOpenPaperTrade({
    role: "specialist",
    entryPhase: "ARMED",
    liveOrdersEnabled: false,
    runtimePhase: stopped.phase,
  }), false);
  const emergencySettle = settleSymbolPosition(settled.book, settled.session, "R_100", 9, 6);
  assert.equal(emergencySettle.settled, true);
});

test("live orders stay off and both guards reject buy and sell", () => {
  assert.equal(LIVE_ORDERS_ENABLED, false);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ buy: 1 }), /buy/i);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ sell: 1 }), /sell/i);
  assert.throws(
    () => assertAllowedAuthenticatedAccountRequest({ buy: "proposal-id" }),
    /buy/i,
  );
  assert.throws(
    () => assertAllowedAuthenticatedAccountRequest({ sell: 1 }),
    /sell/i,
  );
  assert.equal(paperEntryPermitted("RUNNING", "ARMED", LIVE_ORDERS_ENABLED), true);
  assert.equal(paperEntryPermitted("RUNNING", "ARMED", true), false);
});
