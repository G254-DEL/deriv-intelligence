import {
  noteRuntime,
  type JournalKind,
  type RuntimeState,
} from "./runtime-session";

export type ScanJournalRow = {
  symbol: string;
  specialist: string;
  state: string;
  reason: string;
  slotEligible: boolean;
};

export type ScanJournalNote = {
  kind: JournalKind;
  message: string;
};

const GLOBAL_BLOCKS: { test: RegExp; label: string }[] = [
  { test: /maximum consecutive losses/i, label: "session consecutive-loss limit reached" },
  { test: /maximum session loss/i, label: "session-loss limit reached" },
  { test: /session is paused/i, label: "PAUSED" },
  { test: /loss cooldown active|cooldown is active/i, label: "COOLDOWN" },
  { test: /emergency stop is active/i, label: "EMERGENCY STOP" },
  { test: /runtime is stopped/i, label: "STOPPED" },
  {
    test: /open paper position limit|open paper slots are full|maximum session trades/i,
    label: "global concurrency/risk limit reached",
  },
];

export function globalBlockLabel(reason: string): string | null {
  return GLOBAL_BLOCKS.find((block) => block.test.test(reason))?.label ?? null;
}

export function summarizeScan(params: {
  discovered: number;
  rows: ScanJournalRow[];
}): ScanJournalNote[] {
  const signals = params.rows.filter((row) => row.state === "SIGNAL").length;
  const entries = params.rows.filter((row) => row.slotEligible).length;
  const notes: ScanJournalNote[] = [
    {
      kind: "ROUTER_SCANNING",
      message: `SCAN COMPLETE — ${params.discovered} markets scanned, ${params.rows.length} candidates, ${signals} signals, ${entries} entries`,
    },
  ];
  const top = params.rows[0];
  if (top) {
    notes.push({
      kind: "ROUTER_RANK_UPDATED",
      message: `#1 ${top.symbol} ${top.specialist}`,
    });
  }

  const suppressed = new Map<string, number>();
  for (const row of params.rows) {
    const global = globalBlockLabel(row.reason);
    if (global && row.state === "BLOCKED") {
      suppressed.set(global, (suppressed.get(global) ?? 0) + 1);
      continue;
    }
    const specific = specificRejection(row);
    if (specific) {
      notes.push({
        kind: "ENTRY_BLOCKED",
        message: `${row.symbol} ${specific}`,
      });
    }
    if (row.slotEligible) {
      notes.push({
        kind: "ENTRY_ARMED",
        message: `${row.symbol} ${row.specialist} signal`,
      });
    } else if (row.state === "SIGNAL") {
      notes.push({
        kind: "ENTRY_SIGNAL",
        message: `${row.symbol} ${row.specialist} signal`,
      });
    }
  }
  for (const [label, count] of suppressed) {
    notes.push({
      kind: "ENTRY_BLOCKED",
      message: `${label}; ${count} eligible signals suppressed`,
    });
  }
  return notes;
}

export function recordScanNotes(
  state: RuntimeState,
  notes: ScanJournalNote[],
  now: number,
): RuntimeState {
  let next = state;
  for (const note of notes) {
    if (next.journal.some((event) => event.kind === note.kind && event.message === note.message)) {
      continue;
    }
    next = noteRuntime(next, note.kind, note.message, now);
  }
  return next;
}

function specificRejection(row: ScanJournalRow): string | null {
  if (globalBlockLabel(row.reason)) {
    return null;
  }
  const head = row.reason.split(". Score")[0]?.trim() ?? row.reason;
  if (row.state !== "BLOCKED" && !/insufficient sample/i.test(head)) {
    return null;
  }
  return head;
}
