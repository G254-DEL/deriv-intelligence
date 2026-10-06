import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedAuthenticatedAccountRequest } from "../deriv/auth/request-guard";
import { assertAllowedPublicMarketDataRequest } from "../deriv/public-request-guard";
import type { EntryDecision } from "./entry-signal";
import { LIVE_ORDERS_ENABLED } from "./live-orders";
import {
  blockArmedEntries,
  createRuntimeState,
  dispatchRuntime,
  entriesAllowed,
  paperEntryPermitted,
  parseCooldownSeconds,
  recordSessionTrade,
  noteRuntime,
  runtimeControls,
  selectCooldownDuration,
  sessionPerformance,
  type RuntimeState,
} from "./runtime-session";

const COOLDOWN_MS = 5_000;
const armed: EntryDecision = {
  phase: "ARMED",
  armed: true,
  reason: "Entry conditions are satisfied",
};

test("RUN starts a new paper session and does not force a trade", () => {
  const started = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS);
  assert.equal(started.accepted, true);
  assert.equal(started.state.phase, "RUNNING");
  assert.equal(started.state.trades.length, 0);
  assert.equal(entriesAllowed(started.state.phase), true);
  assert.equal(paperEntryPermitted(started.state.phase, "WATCHING", false), false);
  assert.equal(paperEntryPermitted(started.state.phase, "ARMED", true), false);
  assert.ok(started.state.session);
  assert.equal(started.state.journal.some((event) => event.kind === "SESSION_STARTED"), true);
  assert.equal(started.state.journal.some((event) => event.kind === "ROUTER_SCANNING"), true);
  assert.equal(started.state.journal.some((event) => event.kind === "ENTRY_HUNTER_ACTIVE"), true);
  assert.equal(blockArmedEntries("STOPPED", armed).armed, false);
});

test("repeated router and entry notes do not flood the journal", () => {
  let state = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  state = noteRuntime(state, "SPECIALIST_ASSIGNED", "Under 7 Hunter assigned → R_75", 2_000);
  state = noteRuntime(state, "ENTRY_SIGNAL", "Entry Signal Hunter → SIGNAL", 2_100);
  state = noteRuntime(state, "SPECIALIST_ASSIGNED", "Under 7 Hunter assigned → R_75", 2_200);
  state = noteRuntime(state, "ENTRY_SIGNAL", "Entry Signal Hunter → SIGNAL", 2_300);
  state = noteRuntime(state, "ENTRY_SIGNAL", "Entry Signal Hunter → WATCHING", 2_400);
  assert.equal(state.journal.filter((event) => event.kind === "SPECIALIST_ASSIGNED").length, 1);
  assert.equal(state.journal.filter((event) => event.kind === "ENTRY_SIGNAL").length, 2);
});

test("RUN cannot start a duplicate session", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  const duplicate = dispatchRuntime(running, "RUN", 2_000, COOLDOWN_MS);
  const paused = dispatchRuntime(running, "PAUSE", 1_500, COOLDOWN_MS).state;
  const pausedRun = dispatchRuntime(paused, "RUN", 1_600, COOLDOWN_MS);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.state.session?.id, running.session?.id);
  assert.equal(pausedRun.accepted, false);
  assert.equal(pausedRun.state.session?.id, running.session?.id);
  assert.equal(runtimeControls("RUNNING").run, false);
});

test("PAUSE blocks new entries and preserves the session", () => {
  const running = withTrade(dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state);
  const paused = dispatchRuntime(running, "PAUSE", 2_000, COOLDOWN_MS);
  assert.equal(paused.accepted, true);
  assert.equal(paused.state.phase, "PAUSED");
  assert.equal(paused.state.session?.id, running.session?.id);
  assert.equal(sessionPerformance(paused.state, running.session!.id).profitLoss, 1.5);
  assert.equal(entriesAllowed(paused.state.phase), false);
  assert.equal(paperEntryPermitted(paused.state.phase, "ARMED", false), false);
  assert.equal(blockArmedEntries("PAUSED", armed).phase, "WATCHING");
});

test("RESUME continues the same session and does not force a trade", () => {
  const running = withTrade(dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state);
  const paused = dispatchRuntime(running, "PAUSE", 2_000, COOLDOWN_MS).state;
  const resumed = dispatchRuntime(paused, "RESUME", 3_000, COOLDOWN_MS);
  assert.equal(resumed.accepted, true);
  assert.equal(resumed.state.phase, "RUNNING");
  assert.equal(resumed.state.session?.id, running.session?.id);
  assert.equal(resumed.state.session?.startedAt, 1_000);
  assert.equal(sessionPerformance(resumed.state, running.session!.id).trades, 1);
  assert.equal(resumed.state.journal.some((event) => event.kind === "SESSION_RESUMED"), true);
  assert.equal(paperEntryPermitted(resumed.state.phase, "WATCHING", false), false);
});

test("STOPPED cannot resume", () => {
  const stopped = createRuntimeState();
  const resume = dispatchRuntime(stopped, "RESUME", 1_000, COOLDOWN_MS);
  assert.equal(resume.accepted, false);
  assert.equal(resume.state.phase, "STOPPED");
  assert.equal(runtimeControls("STOPPED").resume, false);
  assert.equal(runtimeControls("STOPPED").run, true);
});

test("emergency stop blocks entries and resume cannot bypass it", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  const stopped = dispatchRuntime(running, "EMERGENCY_STOP", 2_000, COOLDOWN_MS);
  const resume = dispatchRuntime(stopped.state, "RESUME", 2_100, COOLDOWN_MS);
  const run = dispatchRuntime(stopped.state, "RUN", 2_200, COOLDOWN_MS);
  assert.equal(stopped.accepted, true);
  assert.equal(stopped.state.phase, "EMERGENCY_STOPPED");
  assert.equal(entriesAllowed(stopped.state.phase), false);
  assert.equal(paperEntryPermitted(stopped.state.phase, "ARMED", false), false);
  assert.equal(resume.accepted, false);
  assert.equal(run.accepted, false);
  assert.equal(resume.state.phase, "EMERGENCY_STOPPED");
  const cleared = dispatchRuntime(stopped.state, "CLEAR_EMERGENCY", 3_000, COOLDOWN_MS);
  assert.equal(cleared.state.phase, "STOPPED");
  assert.equal(cleared.state.journal.some((event) => event.kind === "EMERGENCY_STOP_CLEARED"), true);
  assert.equal(cleared.state.journal.some((event) => event.kind === "SESSION_STOPPED"), true);
});

test("a new RUN gets a new session id and keeps prior trades on the old session", () => {
  const first = withTrade(dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state);
  const emergency = dispatchRuntime(first, "EMERGENCY_STOP", 2_000, COOLDOWN_MS).state;
  const cleared = dispatchRuntime(emergency, "CLEAR_EMERGENCY", 3_000, COOLDOWN_MS).state;
  const second = dispatchRuntime(cleared, "RUN", 4_000, COOLDOWN_MS).state;
  assert.notEqual(second.session?.id, first.session?.id);
  assert.equal(sessionPerformance(second, first.session!.id).profitLoss, 1.5);
  assert.equal(sessionPerformance(second, second.session!.id).trades, 0);
  assert.equal(sessionPerformance(second, second.session!.id).profitLoss, 0);
});

test("an open paper result still settles during pause, cooldown, and emergency stop", () => {
  let state = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  const sessionId = state.session!.id;
  state = dispatchRuntime(state, "PAUSE", 1_100, COOLDOWN_MS).state;
  state = settle(state, sessionId, "trade-pause", false, -1);
  state = dispatchRuntime(state, "RESUME", 1_200, COOLDOWN_MS).state;
  state = dispatchRuntime(state, "COOLDOWN", 1_300, COOLDOWN_MS).state;
  assert.equal(state.phase, "COOLDOWN");
  assert.equal(entriesAllowed(state.phase), false);
  state = settle(state, sessionId, "trade-cool", true, 0.8);
  const early = dispatchRuntime(state, "COOLDOWN_EXPIRED", 1_301, COOLDOWN_MS);
  assert.equal(early.accepted, false);
  state = dispatchRuntime(state, "COOLDOWN_EXPIRED", 1_300 + COOLDOWN_MS, COOLDOWN_MS).state;
  assert.equal(state.phase, "RUNNING");
  state = dispatchRuntime(state, "EMERGENCY_STOP", 8_000, COOLDOWN_MS).state;
  state = settle(state, sessionId, "trade-stop", false, -1);
  const stats = sessionPerformance(state, sessionId);
  assert.equal(stats.trades, 3);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 2);
  assert.equal(Number(stats.profitLoss.toFixed(2)), -1.2);
  assert.equal(paperEntryPermitted(state.phase, "ARMED", LIVE_ORDERS_ENABLED), false);
});

test("cooldown can be cancelled without forcing a trade", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  const cooling = dispatchRuntime(running, "COOLDOWN", 1_200, COOLDOWN_MS).state;
  const cancelled = dispatchRuntime(cooling, "CANCEL_COOLDOWN", 1_400, COOLDOWN_MS);
  assert.equal(cancelled.state.phase, "RUNNING");
  assert.equal(cancelled.state.session?.id, running.session?.id);
  assert.equal(cancelled.state.trades.length, 0);
  assert.equal(cancelled.state.journal.some((event) => event.kind === "COOLDOWN_CANCELLED"), true);
});

test("custom cooldown accepts 5 seconds and rejects anything shorter or invalid", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  const minimum = selectCooldownDuration(running, 5);
  assert.equal(minimum.accepted, true);
  assert.equal(minimum.state.session?.cooldownDurationMs, 5_000);
  const started = dispatchRuntime(minimum.state, "COOLDOWN", 2_000, 5_000);
  assert.equal(started.accepted, true);
  assert.equal(started.state.session?.cooldownUntil, 7_000);

  for (const value of [4, 4.9, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const rejected = selectCooldownDuration(running, value);
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.state.session?.cooldownDurationMs, running.session?.cooldownDurationMs);
  }
  for (const value of ["", "abc", "5 seconds", "NaN", "4", "-5", "Infinity"]) {
    const parsed = parseCooldownSeconds(value);
    assert.equal(parsed.ok, false);
  }
  assert.equal(parseCooldownSeconds("5").ok, true);
  assert.equal(selectCooldownDuration(running, 4).state.phase, "RUNNING");
  const tampered: RuntimeState = {
    ...running,
    cooldownDurationMs: 1_000,
    session: running.session ? { ...running.session, cooldownDurationMs: 1_000 } : null,
  };
  const blocked = dispatchRuntime(tampered, "COOLDOWN", 2_000, 1_000);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.state.phase, "RUNNING");
});

test("custom cooldown accepts large finite durations and has no maximum", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  for (const seconds of [10, 30, 60, 300, 3600, 10_000_000]) {
    const selected = selectCooldownDuration(running, seconds);
    assert.equal(selected.accepted, true);
    assert.equal(selected.state.cooldownDurationMs, seconds * 1000);
    assert.equal(selected.state.session?.cooldownDurationMs, seconds * 1000);
  }
  const huge = parseCooldownSeconds("1e15");
  assert.equal(huge.ok, true);
  if (huge.ok) {
    assert.equal(Number.isFinite(huge.durationMs), true);
    assert.ok(huge.durationMs > 10_000_000 * 1000);
  }
  assert.equal(parseCooldownSeconds(Number.MAX_VALUE).ok, false);
  const beforeRun = selectCooldownDuration(createRuntimeState(), 60);
  const started = dispatchRuntime(beforeRun.state, "RUN", 5_000, 5_000).state;
  assert.equal(started.session?.cooldownDurationMs, 60_000);
  assert.equal(started.cooldownDurationMs, 60_000);
});

test("cooldown uses the selected duration and blocks entries until it expires", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  const selected = selectCooldownDuration(running, 30);
  assert.equal(selected.state.session?.id, running.session?.id);
  const paused = dispatchRuntime(selected.state, "PAUSE", 1_100, COOLDOWN_MS).state;
  assert.equal(paused.session?.cooldownDurationMs, 30_000);
  const resumed = dispatchRuntime(paused, "RESUME", 1_200, COOLDOWN_MS).state;
  const cooling = dispatchRuntime(resumed, "COOLDOWN", 2_000, 5_000);
  assert.equal(cooling.accepted, true);
  assert.equal(cooling.state.phase, "COOLDOWN");
  assert.equal(cooling.state.session?.cooldownDurationMs, 30_000);
  assert.equal(cooling.state.session?.cooldownUntil, 32_000);
  assert.equal(entriesAllowed(cooling.state.phase), false);
  assert.equal(paperEntryPermitted(cooling.state.phase, "ARMED", false), false);
  assert.equal(blockArmedEntries(cooling.state.phase, armed).armed, false);
  const early = dispatchRuntime(cooling.state, "COOLDOWN_EXPIRED", 31_999, 5_000);
  assert.equal(early.accepted, false);
  assert.equal(early.state.phase, "COOLDOWN");
  const expired = dispatchRuntime(cooling.state, "COOLDOWN_EXPIRED", 32_000, 5_000);
  assert.equal(expired.accepted, true);
  assert.equal(expired.state.phase, "RUNNING");
  assert.equal(expired.state.session?.id, running.session?.id);
  assert.equal(entriesAllowed(expired.state.phase), true);
  assert.equal(paperEntryPermitted(expired.state.phase, "ARMED", LIVE_ORDERS_ENABLED), true);
  assert.equal(LIVE_ORDERS_ENABLED, false);
  assert.equal(paperEntryPermitted(cooling.state.phase, "ARMED", true), false);
  assert.equal(paperEntryPermitted(expired.state.phase, "ARMED", true), false);
});

test("RUN stays on paper and buy/sell guards stay closed", () => {
  assert.equal(LIVE_ORDERS_ENABLED, false);
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, COOLDOWN_MS).state;
  assert.equal(paperEntryPermitted(running.phase, "ARMED", LIVE_ORDERS_ENABLED), true);
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ buy: 1 }),
    /buy/i,
  );
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ sell: 1 }),
    /sell/i,
  );
  assert.throws(
    () => assertAllowedAuthenticatedAccountRequest({ buy: 1 }),
    /buy/i,
  );
  assert.throws(
    () => assertAllowedAuthenticatedAccountRequest({ sell: 1 }),
    /sell/i,
  );
});

function withTrade(state: RuntimeState): RuntimeState {
  return settle(state, state.session!.id, "trade-1", true, 1.5);
}

function settle(
  state: RuntimeState,
  sessionId: string,
  tradeId: string,
  won: boolean,
  profitLoss: number,
): RuntimeState {
  return recordSessionTrade(state, {
    tradeId,
    sessionId,
    symbol: "R_75",
    strategy: "UNDER_8",
    won,
    profitLoss,
    settledAt: 1_500,
  });
}
