import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedAuthenticatedAccountRequest } from "../deriv/auth/request-guard";
import { assertAllowedPublicMarketDataRequest } from "../deriv/public-request-guard";
import { blockArmedEntries, activityLabel, createRuntimeState, dispatchRuntime, entriesAllowed, noteRuntime, paperEntryPermitted } from "./runtime-session";
import { decideEntry } from "./entry-signal";
import { LIVE_ORDERS_ENABLED } from "./live-orders";
import { routeMarkets } from "./market-router";
import { knownDigitContracts } from "./market-universe";
import { emptyPerformanceBook } from "./performance-memory";
import { simulatedResultLabel } from "./paper-engine";
import { commitOpenPosition, emptyPaperBook, settleSymbolPosition } from "./paper-book";
import { parseProposalQuote, paperProposalRequest } from "./proposal";
import { canPlaceTrade, DEFAULT_RISK_CONFIG } from "./risk";
import { applyPaperSlotLimits, evaluateAssignmentEntries, mayOpenPaperTrade, pipelineState, routerTableRows } from "./run-cycle";
import { createTradingSession } from "./session";
import { fitForStrategy } from "./specialist-edge";
import { closeControlledPaperTrade, openControlledPaperTrade } from "./controller";
import type { TrackedPaperPosition } from "./paper-book";

const strong = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 9, 9];
const weaker = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 8, 8, 9, 9, 7, 7];
const flat = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function market(symbol: string, digits: number[]) {
  return { symbol, marketName: symbol, digits, contracts: knownDigitContracts() };
}

test("RUN scans and ranks deterministic samples without calling them profitable", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, 5_000).state;
  assert.equal(entriesAllowed(running.phase), true);
  assert.equal(running.journal.some((event) => activityLabel(event.kind) === "RUN"), true);
  assert.equal(running.journal.some((event) => activityLabel(event.kind) === "MARKET SCANNED"), true);

  const first = routeMarkets({
    markets: [market("R_50", weaker), market("R_10", strong)],
    performance: emptyPerformanceBook(),
  });
  const second = routeMarkets({
    markets: [market("R_50", weaker), market("R_10", strong)],
    performance: emptyPerformanceBook(),
  });
  assert.deepEqual(
    first.ranked.map((item) => `${item.symbol}:${item.strategy}:${item.rankScore}`),
    second.ranked.map((item) => `${item.symbol}:${item.strategy}:${item.rankScore}`),
  );
  assert.equal(first.ranked[0]?.symbol, "R_10");
  assert.match(first.ranked[0]?.reason ?? "", /DIGITUNDER|probability/i);
  assert.doesNotMatch(first.ranked[0]?.reason ?? "", /profit/i);

  const rows = routerTableRows({
    assignments: first.assignments,
    entries: evaluateAssignmentEntries({
      assignments: first.assignments,
      digits: { R_10: strong, R_50: weaker },
      openSymbols: new Set(),
      phase: "RUNNING",
      riskAllowed: true,
      riskReason: "Trade allowed",
      minimumConfidence: 0.5,
    }),
    openSymbols: new Set(),
  });
  assert.equal(rows[0]?.state, "SIGNAL");
  assert.match(rows[0]?.reason ?? "", /Score/);
  assert.doesNotMatch(rows[0]?.reason ?? "", /profit/i);
  const blockedRows = routerTableRows({
    assignments: first.assignments,
    entries: evaluateAssignmentEntries({
      assignments: first.assignments,
      digits: { R_10: strong, R_50: weaker },
      openSymbols: new Set(),
      phase: "RUNNING",
      riskAllowed: false,
      riskReason: "Maximum consecutive losses reached",
      minimumConfidence: 0.5,
    }),
    openSymbols: new Set(),
  });
  assert.equal(blockedRows[0]?.state, "BLOCKED");
  assert.match(blockedRows[0]?.reason ?? "", /Maximum consecutive losses reached/);
});

test("PAUSE, RESUME, COOLDOWN, and STOP gate entries and slots follow rank", () => {
  let state = dispatchRuntime(createRuntimeState(), "RUN", 1_000, 5_000).state;
  const routed = routeMarkets({
    markets: [market("R_10", strong), market("R_25", strong), market("R_50", strong), market("R_75", strong)],
    performance: emptyPerformanceBook(),
  });
  const runningEntries = evaluateAssignmentEntries({
    assignments: routed.assignments,
    digits: { R_10: strong, R_25: strong, R_50: strong, R_75: strong },
    openSymbols: new Set(),
    phase: "RUNNING",
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0.5,
  });
  assert.equal(mayOpenPaperTrade({
    role: "specialist",
    entryPhase: runningEntries.R_10.phase,
    liveOrdersEnabled: false,
    runtimePhase: state.phase,
  }), true);

  state = dispatchRuntime(state, "PAUSE", 1_100, 5_000).state;
  const paused = blockArmedEntries(state.phase, runningEntries.R_10);
  assert.equal(entriesAllowed(state.phase), false);
  assert.equal(pipelineState(paused, false), "BLOCKED");
  assert.match(paused.reason, /paused/i);
  assert.equal(activityLabel("SESSION_PAUSED"), "PAUSED");

  state = dispatchRuntime(state, "RESUME", 1_200, 5_000).state;
  assert.equal(entriesAllowed(state.phase), true);
  assert.equal(activityLabel("SESSION_RESUMED"), "RESUMED");
  assert.equal(pipelineState(runningEntries.R_10, false), "SIGNAL");

  state = dispatchRuntime(state, "COOLDOWN", 1_300, 5_000).state;
  assert.equal(state.session?.cooldownUntil, 1_300 + 5_000);
  assert.equal(paperEntryPermitted(state.phase, "ARMED", false), false);
  assert.equal(activityLabel("COOLDOWN_STARTED"), "COOLDOWN STARTED");
  const early = dispatchRuntime(state, "COOLDOWN_EXPIRED", 2_000, 5_000);
  assert.equal(early.accepted, false);
  state = dispatchRuntime(state, "COOLDOWN_EXPIRED", 6_300, 5_000).state;
  assert.equal(state.phase, "RUNNING");

  state = dispatchRuntime(state, "EMERGENCY_STOP", 7_000, 5_000).state;
  assert.equal(entriesAllowed(state.phase), false);
  assert.equal(mayOpenPaperTrade({
    role: "specialist",
    entryPhase: "ARMED",
    liveOrdersEnabled: false,
    runtimePhase: state.phase,
  }), false);
  assert.equal(activityLabel("EMERGENCY_STOP_ACTIVATED"), "STOPPED");

  const limited = applyPaperSlotLimits(
    routerTableRows({
      assignments: routed.assignments,
      entries: runningEntries,
      openSymbols: new Set(),
    }),
    new Set(),
    DEFAULT_RISK_CONFIG.maxOpenPaperPositions,
  );
  assert.equal(limited.slots.size, DEFAULT_RISK_CONFIG.maxOpenPaperPositions);
  assert.equal(DEFAULT_RISK_CONFIG.maxOpenPaperPositions, 3);
  const blocked = limited.rows.filter((row) => row.state === "BLOCKED");
  assert.ok(blocked.length >= 1);
  assert.match(blocked[0]?.reason ?? "", /slots are full/i);
  assert.ok([...limited.slots].every((symbol) => {
    const row = limited.rows.find((item) => item.symbol === symbol);
    const blockedRank = blocked[0]?.rank ?? 0;
    return (row?.rank ?? 99) < blockedRank;
  }));
});

test("an approved signal opens one paper position and a rejected signal does not", () => {
  const session = createTradingSession();
  const fit = fitForStrategy(strong, "UNDER_7");
  assert.equal(fit?.qualified, true);
  const approved = decideEntry({
    enabled: true,
    open: false,
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0.5,
    fit,
  });
  assert.equal(approved.phase, "ARMED");
  const quote = parseProposalQuote({ id: "pipe-1", ask_price: 1, payout: 1.95 });
  assert.ok(quote);
  const opened = openControlledPaperTrade(session, {
    strategy: "UNDER_7",
    symbol: "R_10",
    contractType: "DIGITUNDER",
    barrier: 7,
    entryDigit: 1,
    confidence: fit?.probability ?? 0,
    quote,
  });
  assert.equal(opened.allowed, true);
  assert.ok(opened.trade);
  const tracked: TrackedPaperPosition = {
    ...opened.trade,
    proposalId: "pipe-1",
    entryEpoch: 10,
    runtimeSessionId: "session-1",
    signalKey: "R_10|UNDER_7|10",
    confidence: fit?.probability ?? 0,
  };
  const committed = commitOpenPosition(emptyPaperBook(), tracked);
  assert.equal(committed.accepted, true);
  const duplicate = commitOpenPosition(committed.book, { ...tracked, proposalId: "pipe-2", signalKey: "other" });
  assert.equal(duplicate.accepted, false);
  assert.match(duplicate.reason, /already/i);

  const rejectedFit = fitForStrategy(flat, "UNDER_7");
  const rejected = decideEntry({
    enabled: true,
    open: false,
    riskAllowed: true,
    riskReason: "Trade allowed",
    minimumConfidence: 0.5,
    fit: rejectedFit,
  });
  assert.equal(rejected.armed, false);
  assert.equal(pipelineState(rejected, false), "BLOCKED");
  assert.equal(mayOpenPaperTrade({
    role: "specialist",
    entryPhase: rejected.phase,
    liveOrdersEnabled: LIVE_ORDERS_ENABLED,
    runtimePhase: "RUNNING",
  }), false);

  const won = settleSymbolPosition(committed.book, session, "R_10", 3, 11, 2_000);
  assert.equal(won.settled, true);
  assert.equal(won.trade?.status, "WON");
  assert.equal(won.trade?.exitDigit, 3);
  assert.equal(won.session.wins, 1);
  assert.equal(simulatedResultLabel(won.trade!), "0.95");
  assert.equal(simulatedResultLabel({ status: "LOST", quotedPayout: 0, profitLoss: -1 }), "unavailable");

  const lostBook = commitOpenPosition(emptyPaperBook(), { ...tracked, proposalId: "pipe-3", signalKey: "R_25|UNDER_7|12", symbol: "R_25" }).book;
  const lost = settleSymbolPosition(lostBook, createTradingSession(), "R_25", 8, 13, 3_000);
  assert.equal(lost.trade?.status, "LOST");
  assert.equal(lost.session.losses, 1);

  assert.equal(canPlaceTrade(createTradingSession(), DEFAULT_RISK_CONFIG, 1_000, 2).allowed, true);
  const full = canPlaceTrade(createTradingSession(), DEFAULT_RISK_CONFIG, 1_000, 3);
  assert.equal(full.allowed, false);
  assert.match(full.reason, /Open paper position limit/);

  const noted = noteRuntime(dispatchRuntime(createRuntimeState(), "RUN", 1, 5_000).state, "ENTRY_BLOCKED", "R_75 blocked", 2);
  assert.equal(activityLabel(noted.journal.at(-1)!.kind, noted.journal.at(-1)!.message), "ENTRY BLOCKED");
  const settledNote = noteRuntime(noted, "PAPER_TRADE_SETTLED", "Paper trade settled won on R_10.", 3);
  assert.equal(activityLabel("PAPER_TRADE_SETTLED", settledNote.journal.at(-1)!.message), "WIN");
});

test("paper execution stays off the real order path", () => {
  assert.equal(LIVE_ORDERS_ENABLED, false);
  const request = paperProposalRequest({
    symbol: "R_10",
    contractType: "DIGITUNDER",
    barrier: 7,
    currency: "USD",
    amount: 1,
  });
  assert.equal("buy" in request, false);
  assert.equal("sell" in request, false);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ buy: 1 }), /buy/i);
  assert.throws(() => assertAllowedPublicMarketDataRequest({ sell: 1 }), /sell/i);
  assert.throws(() => assertAllowedAuthenticatedAccountRequest({ buy: 1 }), /buy/i);
  assert.throws(() => assertAllowedAuthenticatedAccountRequest({ sell: 1 }), /sell/i);
  const quote = parseProposalQuote({ id: "safe", ask_price: 1, payout: 1.9 });
  assert.ok(quote);
  const closed = closeControlledPaperTrade(
    createTradingSession(),
    {
      id: "t",
      strategy: "UNDER_7",
      symbol: "R_10",
      contractType: "DIGITUNDER",
      barrier: 7,
      stake: 1,
      quotedPayout: quote.payout,
      entryDigit: 1,
      status: "OPEN",
      payout: 0,
      profitLoss: 0,
      openedAt: 1,
    },
    2,
    2,
  );
  assert.equal(closed.trade?.status, "WON");
  assert.equal(LIVE_ORDERS_ENABLED, false);
});
