import assert from "node:assert/strict";
import test from "node:test";
import { createPaperTrade, settlePaperTrade } from "./paper-engine";
import {
  closeControlledPaperTrade,
  openControlledPaperTrade,
  type PaperTradeSignal,
} from "./controller";
import { createTradingSession, recordPaperTrade } from "./session";
import { canPlaceTrade, DEFAULT_RISK_CONFIG } from "./risk";
import { getRecoveryDecision } from "./recovery";
import { strategyWins } from "./strategy-rules";
import type { PaperTrade } from "./types";

const RISK = {
  ...DEFAULT_RISK_CONFIG,
  cooldownAfterLossMs: 5_000,
};

function quoteSignal(
  overrides: Partial<PaperTradeSignal> = {},
): PaperTradeSignal {
  return {
    strategy: "UNDER_7",
    symbol: "1HZ100V",
    contractType: "DIGITUNDER",
    barrier: 7,
    entryDigit: 4,
    confidence: 0.5,
    payoutRatio: 0.8,
    quotedPayout: 1.8,
    ...overrides,
  };
}

function openTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return createPaperTrade({
    strategy: "UNDER_7",
    symbol: "1HZ100V",
    contractType: "DIGITUNDER",
    barrier: 7,
    stake: 1,
    quotedPayout: 1.8,
    entryDigit: 4,
    ...overrides,
  });
}

test("open trades do not change session statistics", () => {
  const session = createTradingSession();
  const recorded = recordPaperTrade(session, openTrade());
  assert.equal(recorded.totalTrades, 0);
  assert.equal(recorded.consecutiveLosses, 0);
});

test("a paper win records quoted payout and resets the losing streak", () => {
  const started = createTradingSession();
  const { session } = closeControlledPaperTrade(started, openTrade(), 3, 1_000);

  assert.equal(session.totalTrades, 1);
  assert.equal(session.wins, 1);
  assert.equal(session.losses, 0);
  assert.equal(session.totalStake, 1);
  assert.equal(session.totalPayout, 1.8);
  assert.equal(session.profitLoss, 0.8);
  assert.equal(session.consecutiveLosses, 0);
  assert.equal(session.lastLossAt, null);
});

test("a paper loss uses zero payout and increments consecutive losses", () => {
  const started = createTradingSession();
  const { session } = closeControlledPaperTrade(started, openTrade(), 8, 2_000);

  assert.equal(session.totalTrades, 1);
  assert.equal(session.wins, 0);
  assert.equal(session.losses, 1);
  assert.equal(session.totalPayout, 0);
  assert.equal(session.profitLoss, -1);
  assert.equal(session.consecutiveLosses, 1);
  assert.equal(session.lastLossAt, 2_000);
});

test("settlement uses the stored proposal payout, not a hardcoded ratio", () => {
  const settled = settlePaperTrade(openTrade({ stake: 2.5, quotedPayout: 4.75 }), 1, true);
  assert.equal(settled.status, "WON");
  assert.equal(settled.payout, 4.75);
  assert.equal(settled.profitLoss, 2.25);
});

test("closing an already settled trade does not double-count the session", () => {
  const first = closeControlledPaperTrade(createTradingSession(), openTrade(), 8, 1_000);
  const second = closeControlledPaperTrade(first.session, first.trade, 8, 2_000);

  assert.equal(second.session.totalTrades, 1);
  assert.equal(second.session.losses, 1);
  assert.equal(second.trade.status, "LOST");
});

test("a win after a loss clears cooldown so the next paper trade can open", () => {
  const afterLoss = closeControlledPaperTrade(
    createTradingSession(),
    openTrade(),
    8,
    1_000,
  );
  const afterWin = closeControlledPaperTrade(
    afterLoss.session,
    openTrade(),
    2,
    1_500,
  );

  assert.equal(afterWin.session.consecutiveLosses, 0);
  assert.equal(afterWin.session.lastLossAt, null);

  const decision = canPlaceTrade(afterWin.session, RISK, 1_600);
  assert.equal(decision.allowed, true);
});

test("loss cooldown blocks a new paper trade until the window elapses", () => {
  const afterLoss = closeControlledPaperTrade(
    createTradingSession(),
    openTrade(),
    8,
    1_000,
  );

  const duringCooldown = canPlaceTrade(afterLoss.session, RISK, 4_000);
  assert.equal(duringCooldown.allowed, false);
  assert.match(duringCooldown.reason, /cooldown/i);

  const afterCooldown = canPlaceTrade(afterLoss.session, RISK, 6_000);
  assert.equal(afterCooldown.allowed, true);
});

test("risk limits stop new paper trades at max consecutive losses", () => {
  let session = createTradingSession();
  for (let i = 0; i < 3; i += 1) {
    const closed = closeControlledPaperTrade(session, openTrade(), 9, 10_000 + i);
    session = closed.session;
  }

  assert.equal(session.consecutiveLosses, 3);
  const decision = canPlaceTrade(session, { ...RISK, cooldownAfterLossMs: 0 }, 20_000);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /consecutive/i);
});

test("risk limits stop new paper trades at max session loss", () => {
  const session = {
    ...createTradingSession(),
    profitLoss: -10,
    totalTrades: 4,
    losses: 4,
  };
  const decision = canPlaceTrade(session, { ...RISK, maxSessionLoss: 10 });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /session loss/i);
});

test("risk limits stop new paper trades at max trades per session", () => {
  const session = {
    ...createTradingSession(),
    totalTrades: 50,
  };
  const decision = canPlaceTrade(session, RISK);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /session trades/i);
});

test("opening a paper trade requires a live proposal quote", () => {
  const result = openControlledPaperTrade(createTradingSession(), quoteSignal({
    payoutRatio: 0,
    quotedPayout: 0,
  }));
  assert.equal(result.allowed, false);
  assert.match(result.reason, /proposal quote/i);
});

test("recovery after one loss requires a stronger signal", () => {
  const session = {
    ...createTradingSession(),
    consecutiveLosses: 1,
    lastLossAt: 1,
    losses: 1,
    totalTrades: 1,
    profitLoss: -1,
  };
  const recovery = getRecoveryDecision(session);
  assert.equal(recovery.recoveryMode, true);
  assert.equal(recovery.minimumConfidence, 0.7);

  const weak = openControlledPaperTrade(
    session,
    quoteSignal({ confidence: 0.5 }),
    { ...RISK, cooldownAfterLossMs: 0 },
  );
  assert.equal(weak.allowed, false);

  const strong = openControlledPaperTrade(
    session,
    quoteSignal({ confidence: 0.75, quotedPayout: 1.8 }),
    { ...RISK, cooldownAfterLossMs: 0 },
  );
  assert.equal(strong.allowed, true);
  assert.ok(strong.trade);
  assert.ok((strong.trade.stake ?? 0) >= RISK.stake);
});

test("strategy rules match digit contracts without placing live orders", () => {
  assert.equal(strategyWins("UNDER_7", 6), true);
  assert.equal(strategyWins("UNDER_7", 7), false);
  assert.equal(strategyWins("OVER_2", 3), true);
  assert.equal(strategyWins("OVER_3", 3), false);
  assert.equal(strategyWins("UNDER_8", 8), false);
  assert.equal(strategyWins("EVEN_ODD", 4, "EVEN"), true);
  assert.equal(strategyWins("EVEN_ODD", 5, "EVEN"), false);
  assert.equal(strategyWins("EVEN_ODD", 5, "ODD"), true);
});

test("DIGITODD paper trades settle from the contract type, not a default even side", () => {
  const trade = openTrade({
    strategy: "EVEN_ODD",
    contractType: "DIGITODD",
  });
  const won = closeControlledPaperTrade(createTradingSession(), trade, 3);
  const lost = closeControlledPaperTrade(createTradingSession(), trade, 4);
  assert.equal(won.trade.status, "WON");
  assert.equal(lost.trade.status, "LOST");
});
