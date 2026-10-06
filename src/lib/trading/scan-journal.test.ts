import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimeState,
  dispatchRuntime,
  JOURNAL_LIMIT,
  noteRuntime,
  recordSessionTrade,
} from "./runtime-session";
import { recordScanNotes, summarizeScan, type ScanJournalRow } from "./scan-journal";

function row(
  symbol: string,
  state: ScanJournalRow["state"],
  reason: string,
  slotEligible = false,
): ScanJournalRow {
  return { symbol, specialist: "Under 7", state, reason, slotEligible };
}

test("a global blocker is one journal summary per scan, not one row per market", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, 5_000).state;
  const rows = Array.from({ length: 6 }, (_, index) =>
    row(
      `R_${index}`,
      "BLOCKED",
      "Maximum consecutive losses reached. DIGITUNDER 7 probability 90.0%. Score 0.3900 from edge 0.2000, sample 20, performance adjustment 0.000.",
    ),
  );
  const notes = summarizeScan({ discovered: 41, rows });
  const blocked = notes.filter((note) => note.kind === "ENTRY_BLOCKED");
  assert.equal(blocked.length, 1);
  assert.equal(
    blocked[0]?.message,
    "session consecutive-loss limit reached; 6 eligible signals suppressed",
  );
  assert.equal(
    notes.find((note) => note.kind === "ROUTER_SCANNING")?.message,
    "SCAN COMPLETE — 41 markets scanned, 6 candidates, 0 signals, 0 entries",
  );

  const once = recordScanNotes(running, notes, 2_000);
  const twice = recordScanNotes(once, notes, 3_000);
  assert.equal(twice.journal.filter((event) => event.kind === "ENTRY_BLOCKED").length, 1);
  assert.equal(twice.journal.filter((event) => event.message.startsWith("SCAN COMPLETE")).length, 1);
});

test("market-specific rejections stay traceable and trade events survive dedupe", () => {
  const running = dispatchRuntime(createRuntimeState(), "RUN", 1_000, 5_000).state;
  const rows = [
    row("R_10", "BLOCKED", "Insufficient sample"),
    row("R_25", "BLOCKED", "Edge below the live threshold"),
    row("R_50", "SIGNAL", "DIGITUNDER 7 probability 90.0%. Score 0.1000 from edge 0.1000, sample 20, performance adjustment 0.000.", true),
    row("R_75", "BLOCKED", "Maximum consecutive losses reached. Score 0.1000 from edge 0.1000, sample 20, performance adjustment 0.000."),
    row("R_100", "BLOCKED", "Maximum consecutive losses reached. Score 0.0900 from edge 0.0900, sample 20, performance adjustment 0.000."),
  ];
  const notes = summarizeScan({ discovered: 41, rows });
  let state = recordScanNotes(running, notes, 2_000);
  state = noteRuntime(state, "PAPER_TRADE_OPENED", "Paper trade opened UNDER_7 on R_50.", 2_100);
  state = recordSessionTrade(state, {
    tradeId: "trade-1",
    sessionId: state.session!.id,
    symbol: "R_50",
    strategy: "UNDER_7",
    won: true,
    profitLoss: 0.95,
    settledAt: 2_200,
  });
  state = recordScanNotes(state, notes, 2_300);

  const blocked = state.journal.filter((event) => event.kind === "ENTRY_BLOCKED");
  assert.equal(blocked.filter((event) => event.message.startsWith("R_10")).length, 1);
  assert.match(blocked.find((event) => event.message.startsWith("R_10"))?.message ?? "", /Insufficient sample/);
  assert.match(blocked.find((event) => event.message.startsWith("R_25"))?.message ?? "", /Edge below/);
  assert.equal(blocked.filter((event) => /consecutive-loss limit/.test(event.message)).length, 1);
  assert.equal(state.journal.filter((event) => event.kind === "PAPER_TRADE_OPENED").length, 1);
  assert.equal(state.journal.filter((event) => event.kind === "PAPER_TRADE_SETTLED").length, 1);
  assert.equal(state.journal.filter((event) => event.kind === "ENTRY_ARMED").length, 1);
});

test("the activity journal keeps only the newest retained records", () => {
  let state = dispatchRuntime(createRuntimeState(), "RUN", 1_000, 5_000).state;
  for (let index = 0; index < JOURNAL_LIMIT + 40; index += 1) {
    state = noteRuntime(state, "SAMPLE_READY", `sample ${index}`, 2_000 + index);
  }
  assert.equal(state.journal.length, JOURNAL_LIMIT);
  assert.equal(state.journal.at(-1)?.message, `sample ${JOURNAL_LIMIT + 39}`);
  assert.equal(state.journal.some((event) => event.message === "sample 0"), false);
});
