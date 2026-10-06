import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedPublicMarketDataRequest } from "../deriv/public-request-guard";
import {
  activeSymbols,
  emptySubscriptionLedger,
  releaseConsumer,
  retainConsumer,
  setOwnerSymbols,
} from "../deriv/subscription-ledger";
import { openArmedPaperTrade } from "./armed-paper-trade";
import { decideEntry } from "./entry-signal";
import { routeMarkets } from "./market-router";
import { knownDigitContracts } from "./market-universe";
import {
  emptyPerformanceBook,
  performanceAdjustment,
  recordPaperOutcome,
} from "./performance-memory";
import { paperProposalRequest, parseProposalQuote } from "./proposal";
import { canPlaceTrade, DEFAULT_RISK_CONFIG } from "./risk";
import { createTradingSession } from "./session";
import { evaluateSpecialists, fitForStrategy } from "./specialist-edge";
import { presetById } from "./bot-presets";
import {
  gateForMasterRole,
  paperExecutionPermitted,
  resolveActiveMasterRole,
} from "./master-role";
import { closeControlledPaperTrade, openControlledPaperTrade } from "./controller";

function digitsFrom(pattern: number[]): number[] {
  return pattern;
}

function market(symbol: string, marketName: string, digits: number[]) {
  return { symbol, marketName, digits, contracts: knownDigitContracts() };
}

const underSample = digitsFrom([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 9, 9,
]);
const overSample = digitsFrom([
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 0, 0, 0, 0,
]);
const evenSample = digitsFrom([0, 2, 4, 6, 8, 0, 2, 4, 6, 8, 0, 2, 4, 6, 1, 3, 5, 7, 9, 1]);
const oddSample = digitsFrom([1, 3, 5, 7, 9, 1, 3, 5, 7, 9, 1, 3, 5, 7, 0, 2, 4, 6, 8, 0]);
const flatSample = digitsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

test("Under 7 and Under 8 use different barrier probabilities", () => {
  const under7 = fitForStrategy(underSample, "UNDER_7");
  const under8 = fitForStrategy(underSample, "UNDER_8");
  assert.equal(under7?.barrier, 7);
  assert.equal(under7?.contractType, "DIGITUNDER");
  assert.equal(under8?.barrier, 8);
  assert.equal(under8?.contractType, "DIGITUNDER");
  assert.notEqual(under7?.probability, under8?.probability);
  assert.equal(under7?.qualified, true);
  assert.equal(under8?.qualified, true);
});

test("Over 2 and Over 3 use different barrier probabilities", () => {
  const over2 = fitForStrategy(overSample, "OVER_2");
  const over3 = fitForStrategy(overSample, "OVER_3");
  assert.equal(over2?.barrier, 2);
  assert.equal(over3?.barrier, 3);
  assert.ok((over2?.probability ?? 0) > (over3?.probability ?? 1));
  assert.equal(over2?.qualified, true);
  assert.equal(over3?.qualified, true);
});

test("Even/Odd selects the biased side and waits when neither side qualifies", () => {
  const even = fitForStrategy(evenSample, "EVEN_ODD");
  const odd = fitForStrategy(oddSample, "EVEN_ODD");
  const flat = fitForStrategy(flatSample, "EVEN_ODD");
  assert.equal(even?.qualified, true);
  assert.equal(even?.contractType, "DIGITEVEN");
  assert.equal(even?.evenOddSide, "EVEN");
  assert.equal(odd?.qualified, true);
  assert.equal(odd?.contractType, "DIGITODD");
  assert.equal(odd?.evenOddSide, "ODD");
  assert.equal(flat?.qualified, false);
  assert.match(flat?.reason ?? "", /neither even nor odd/i);
});

test("entry gate rejects weak, short, duplicate, and stale setups", () => {
  const weak = fitForStrategy(flatSample, "UNDER_7");
  const short = fitForStrategy([0, 0, 0], "UNDER_7");
  const qualified = fitForStrategy(underSample, "UNDER_7");
  assert.equal(
    decideEntry({
      enabled: true,
      open: false,
      riskAllowed: true,
      riskReason: "Trade allowed",
      minimumConfidence: 0,
      fit: weak,
    }).phase,
    "WATCHING",
  );
  assert.equal(
    decideEntry({
      enabled: true,
      open: false,
      riskAllowed: true,
      riskReason: "Trade allowed",
      minimumConfidence: 0,
      fit: short,
    }).reason,
    "Insufficient sample",
  );
  assert.equal(
    decideEntry({
      enabled: true,
      open: true,
      riskAllowed: true,
      riskReason: "Trade allowed",
      minimumConfidence: 0,
      fit: qualified,
    }).phase,
    "PAPER_TRADE_OPEN",
  );
  assert.equal(
    decideEntry({
      enabled: true,
      open: false,
      riskAllowed: true,
      riskReason: "Trade allowed",
      minimumConfidence: 0,
      fit: qualified,
    }).phase,
    "ARMED",
  );
});

test("router ranks a qualified specialist and skips a cooled-down pair", () => {
  let book = emptyPerformanceBook();
  book = recordPaperOutcome(book, {
    market: "R_10",
    strategy: "UNDER_7",
    contractType: "DIGITUNDER",
    barrier: 7,
    won: false,
    profitLoss: -1,
    confidence: 0.8,
  });
  book = recordPaperOutcome(book, {
    market: "R_10",
    strategy: "UNDER_7",
    contractType: "DIGITUNDER",
    barrier: 7,
    won: false,
    profitLoss: -1,
    confidence: 0.8,
  });

  const routed = routeMarkets({
    markets: [
      market("R_10", "Volatility 10", underSample),
      market("R_25", "Volatility 25", underSample),
    ],
    performance: book,
  });
  assert.equal(
    routed.ranked.some((item) => item.symbol === "R_10" && item.strategy === "UNDER_7"),
    false,
  );
  assert.notEqual(routed.assignments.R_10?.strategy, "UNDER_7");
  assert.ok(routed.assignments.R_25);
  assert.equal(routed.assignments.R_10?.symbol, "R_10");
  assert.equal(routed.assignments.R_25?.symbol, "R_25");
});

test("historical performance cannot arm a weak live sample", () => {
  let book = emptyPerformanceBook();
  for (let index = 0; index < 4; index += 1) {
    book = recordPaperOutcome(book, {
      market: "R_50",
      strategy: "OVER_3",
      contractType: "DIGITOVER",
      barrier: 3,
      won: true,
      profitLoss: 0.5,
      confidence: 0.7,
    });
  }
  assert.equal(performanceAdjustment(book, "R_50", "OVER_3"), 0.1);
  const routed = routeMarkets({
    markets: [market("R_50", "Volatility 50", flatSample)],
    performance: book,
  });
  const over3 = routed.evaluated.find((item) => item.strategy === "OVER_3");
  assert.equal(over3?.ready, false);
  assert.equal(
    routed.ranked.some((item) => item.symbol === "R_50" && item.strategy === "OVER_3"),
    false,
  );
  assert.equal(
    decideEntry({
      enabled: true,
      open: false,
      riskAllowed: true,
      riskReason: "Trade allowed",
      minimumConfidence: 0,
      fit: fitForStrategy(flatSample, "OVER_3"),
    }).armed,
    false,
  );
});

test("poor recent performance lowers ranking without changing stake rules", () => {
  let book = emptyPerformanceBook();
  for (let index = 0; index < 3; index += 1) {
    book = recordPaperOutcome(book, {
      market: "R_75",
      strategy: "OVER_2",
      contractType: "DIGITOVER",
      barrier: 2,
      won: false,
      profitLoss: -1,
      confidence: 0.8,
    });
  }
  assert.ok(performanceAdjustment(book, "R_75", "OVER_2") < 0);
  const stats = book.records[0];
  assert.equal(stats.losses, 3);
  assert.equal(stats.trades, 3);
  assert.equal(DEFAULT_RISK_CONFIG.stake, 1);
});

test("cooldown and session loss keep the entry gate closed", () => {
  const cooled = {
    ...createTradingSession(),
    consecutiveLosses: 1,
    lastLossAt: Date.now(),
  };
  const risk = canPlaceTrade(cooled, DEFAULT_RISK_CONFIG);
  assert.equal(risk.allowed, false);
  assert.equal(
    decideEntry({
      enabled: true,
      open: false,
      riskAllowed: risk.allowed,
      riskReason: risk.reason,
      minimumConfidence: 0,
      fit: fitForStrategy(underSample, "UNDER_7"),
    }).phase,
    "COOLDOWN",
  );

  const drained = canPlaceTrade(
    { ...createTradingSession(), profitLoss: -10, totalTrades: 4, consecutiveLosses: 4 },
    DEFAULT_RISK_CONFIG,
  );
  assert.equal(drained.allowed, false);
});

test("a failed or invalid proposal does not open a paper trade", async () => {
  const fit = fitForStrategy(underSample, "UNDER_7");
  assert.ok(fit);
  const inFlight: Record<string, boolean> = {};
  const rejected = await openArmedPaperTrade({
    client: {
      requestProposal: async () => {
        throw new Error("Deriv rejected the proposal");
      },
    },
    symbol: "R_10",
    fit,
    session: createTradingSession(),
    currency: "USD",
    targetProfit: 0.1,
    inFlight,
  });
  const malformed = await openArmedPaperTrade({
    client: {
      requestProposal: async () => ({ id: "", ask_price: 1, payout: 2 }),
    },
    symbol: "R_10",
    fit,
    session: createTradingSession(),
    currency: "USD",
    targetProfit: 0.1,
    inFlight,
  });
  assert.equal(rejected, null);
  assert.equal(malformed, null);
  assert.equal(inFlight.R_10, false);
});

test("subscription owners and consumers do not evict each other", () => {
  let ledger = emptySubscriptionLedger();
  ledger = setOwnerSymbols(ledger, "under-7", ["R_10"], 1);
  ledger = setOwnerSymbols(ledger, "over-2", ["R_25"], 1);
  ledger = retainConsumer(ledger, "R_50");
  ledger = retainConsumer(ledger, "R_50");
  assert.deepEqual(activeSymbols(ledger, 10), ["R_10", "R_25", "R_50"]);
  ledger = releaseConsumer(ledger, "R_50");
  assert.deepEqual(activeSymbols(ledger, 10), ["R_10", "R_25", "R_50"]);
  ledger = releaseConsumer(ledger, "R_50");
  assert.deepEqual(activeSymbols(ledger, 10), ["R_10", "R_25"]);
});

test("Market Router ranks and assigns without arming an entry", async () => {
  const router = presetById("autoswitcher");
  assert.equal(resolveActiveMasterRole(router), "router");
  const routed = routeMarkets({
    markets: [market("R_75", "Volatility 75", underSample)],
    performance: emptyPerformanceBook(),
  });
  assert.equal(routed.assignments.R_75?.symbol, "R_75");
  assert.ok(routed.assignments.R_75?.ready);
  assert.equal(routed.assignments.R_75?.strategy, routed.ranked[0]?.strategy);
  const fit = fitForStrategy(underSample, "UNDER_8");
  const armed = decideEntry({
    enabled: true,
    open: false,
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0,
    fit,
  });
  assert.equal(armed.phase, "ARMED");
  const gated = gateForMasterRole("router", armed);
  assert.equal(gated.phase, "SIGNAL");
  assert.equal(gated.armed, false);
  assert.equal(paperExecutionPermitted("router", armed.phase), false);

  let proposalRequests = 0;
  if (paperExecutionPermitted("router", armed.phase) && fit) {
    await openArmedPaperTrade({
      client: {
        requestProposal: async () => {
          proposalRequests += 1;
          return { id: "should-not-run", ask_price: 1, payout: 1.8 };
        },
      },
      symbol: "R_75",
      fit,
      session: createTradingSession(),
      currency: "USD",
      targetProfit: 0.1,
      inFlight: {},
    });
  }
  assert.equal(proposalRequests, 0);
});

test("Entry Signal Hunter waits, then arms, and only then permits specialist execution", async () => {
  const hunter = presetById("entrypoint-hunter");
  assert.equal(resolveActiveMasterRole(hunter), "entry");
  const routed = routeMarkets({
    markets: [market("R_75", "Volatility 75", underSample)],
    performance: emptyPerformanceBook(),
  });
  assert.equal(routed.assignments.R_75?.symbol, "R_75");

  const short = decideEntry({
    enabled: true,
    open: false,
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0,
    fit: fitForStrategy([0, 1, 2], "UNDER_8"),
  });
  const belowRecovery = decideEntry({
    enabled: true,
    open: false,
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0.95,
    fit: fitForStrategy(underSample, "UNDER_8"),
  });
  const ready = decideEntry({
    enabled: true,
    open: false,
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0,
    fit: fitForStrategy(underSample, "UNDER_8"),
  });

  assert.equal(gateForMasterRole("entry", short).phase, "WATCHING");
  assert.equal(paperExecutionPermitted("entry", short.phase), false);
  assert.equal(gateForMasterRole("entry", belowRecovery).phase, "SIGNAL");
  assert.equal(paperExecutionPermitted("entry", belowRecovery.phase), false);
  assert.equal(gateForMasterRole("entry", ready).phase, "ARMED");
  assert.equal(paperExecutionPermitted("entry", ready.phase), true);
  assert.equal(paperExecutionPermitted("specialist", "SIGNAL"), false);
  assert.equal(paperExecutionPermitted("specialist", "ARMED"), true);
  assert.equal(resolveActiveMasterRole(presetById("under-hunter"), "UNDER_8"), "specialist");

  const fit = fitForStrategy(underSample, "UNDER_8");
  assert.ok(fit);
  const requests: number[] = [];
  const opened = paperExecutionPermitted("entry", ready.phase)
    ? await openArmedPaperTrade({
        client: {
          requestProposal: async (request) => {
            requests.push(request.amount);
            assert.equal("buy" in request, false);
            assert.equal("sell" in request, false);
            return { id: "under-8", ask_price: request.amount, payout: request.amount * 1.8 };
          },
        },
        symbol: "R_75",
        fit,
        session: createTradingSession(),
        currency: "USD",
        targetProfit: 0.1,
        riskConfig: { ...DEFAULT_RISK_CONFIG, stake: 1 },
        inFlight: {},
      })
    : null;
  assert.equal(requests.length, 1);
  assert.equal(requests[0], 1);
  assert.equal(opened?.strategy, "UNDER_8");
  assert.equal(opened?.symbol, "R_75");
  assert.equal(opened?.stake, 1);
  assert.equal(opened?.status, "OPEN");
});

test("a loss and repeated losses keep the next paper stake at the base stake", () => {
  const baseStake = 1;
  const config = { ...DEFAULT_RISK_CONFIG, stake: baseStake, cooldownAfterLossMs: 0 };
  const quote = parseProposalQuote({ id: "stake-proof", ask_price: baseStake, payout: 1.8 });
  assert.ok(quote);

  let session = createTradingSession();
  const openAt = (current: typeof session) =>
    openControlledPaperTrade(
      current,
      {
        strategy: "UNDER_8",
        symbol: "R_75",
        contractType: "DIGITUNDER",
        barrier: 8,
        entryDigit: 0,
        confidence: 0.9,
        quote,
        targetProfit: 1,
      },
      config,
    );

  const first = openAt(session);
  assert.equal(first.trade?.stake, baseStake);
  session = closeControlledPaperTrade(session, first.trade!, 9).session;
  assert.equal(session.consecutiveLosses, 1);

  const second = openAt(session);
  assert.equal(second.allowed, true);
  assert.equal(second.trade?.stake, baseStake);
  session = closeControlledPaperTrade(session, second.trade!, 9).session;
  assert.equal(session.consecutiveLosses, 2);
  assert.ok(session.profitLoss < 0);

  const third = openAt(session);
  assert.equal(third.allowed, true);
  assert.equal(third.trade?.stake, baseStake);
  assert.ok(session.consecutiveLosses >= 2);
});

test("no paper bot request can carry a live buy or sell", () => {
  const request = paperProposalRequest({
    amount: 1,
    currency: "USD",
    symbol: "R_10",
    contractType: "DIGITUNDER",
    barrier: 7,
  });
  assert.equal("buy" in request, false);
  assert.equal("sell" in request, false);
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ buy: 1, price: 1 }),
    /buy/i,
  );
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ sell: 1 }),
    /sell/i,
  );
  assert.equal(evaluateSpecialists(underSample).some((fit) => fit.probability === 1 && fit.sampleSize < 10), false);
});
