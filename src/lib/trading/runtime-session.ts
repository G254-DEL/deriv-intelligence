import type { EntryDecision } from "./entry-signal";

export type RuntimePhase =
  | "STOPPED"
  | "RUNNING"
  | "PAUSED"
  | "COOLDOWN"
  | "EMERGENCY_STOPPED";

export type RuntimeCommand =
  | "RUN"
  | "PAUSE"
  | "RESUME"
  | "COOLDOWN"
  | "CANCEL_COOLDOWN"
  | "COOLDOWN_EXPIRED"
  | "EMERGENCY_STOP"
  | "CLEAR_EMERGENCY";

export type JournalKind =
  | "SESSION_STARTED"
  | "SESSION_PAUSED"
  | "SESSION_RESUMED"
  | "COOLDOWN_STARTED"
  | "COOLDOWN_CANCELLED"
  | "COOLDOWN_EXPIRED"
  | "EMERGENCY_STOP_ACTIVATED"
  | "EMERGENCY_STOP_CLEARED"
  | "SESSION_STOPPED"
  | "ROUTER_SCANNING"
  | "MARKET_DISCOVERY_STARTED"
  | "MARKET_DISCOVERY_COMPLETE"
  | "MARKET_SUBSCRIBED"
  | "SAMPLE_READY"
  | "OPPORTUNITY_QUALIFIED"
  | "ROUTER_RANK_UPDATED"
  | "ENTRY_HUNTER_ACTIVE"
  | "SPECIALIST_ASSIGNED"
  | "ENTRY_WATCHING"
  | "ENTRY_SIGNAL"
  | "ENTRY_ARMED"
  | "PAPER_TRADE_OPENED"
  | "PAPER_TRADE_SETTLED";

export type RuntimeJournalEvent = {
  sessionId: string;
  kind: JournalKind;
  message: string;
  at: number;
};

export type SessionTradeRecord = {
  tradeId: string;
  sessionId: string;
  symbol: string;
  strategy: string;
  won: boolean;
  profitLoss: number;
  settledAt: number;
};

export type RuntimeSession = {
  id: string;
  startedAt: number;
  stoppedAt: number | null;
  cooldownUntil: number | null;
  cooldownDurationMs: number;
};

export type RuntimeState = {
  phase: RuntimePhase;
  session: RuntimeSession | null;
  journal: RuntimeJournalEvent[];
  trades: SessionTradeRecord[];
  cooldownDurationMs: number;
};

export type RuntimeControls = {
  run: boolean;
  pause: boolean;
  resume: boolean;
  cooldown: boolean;
  cancelCooldown: boolean;
  emergencyStop: boolean;
  clearEmergency: boolean;
};

const JOURNAL_LIMIT = 200;

/** Runtime cooldown cannot be shorter than 5 seconds. There is no maximum. */
export const MIN_COOLDOWN_SECONDS = 5;
export const MIN_COOLDOWN_MS = MIN_COOLDOWN_SECONDS * 1000;

export function createRuntimeState(): RuntimeState {
  return {
    phase: "STOPPED",
    session: null,
    journal: [],
    trades: [],
    cooldownDurationMs: MIN_COOLDOWN_MS,
  };
}

export function parseCooldownSeconds(
  input: unknown,
): { ok: true; seconds: number; durationMs: number } | { ok: false; reason: string } {
  let seconds = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "") {
      return { ok: false, reason: "Cooldown duration is required." };
    }
    if (!/^[+]?\d+(\.\d+)?(?:[eE][+]?\d+)?$/.test(trimmed)) {
      return { ok: false, reason: "Cooldown must be a finite number of seconds." };
    }
    seconds = Number(trimmed);
  }
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return { ok: false, reason: "Cooldown must be a finite number of seconds." };
  }
  if (seconds < MIN_COOLDOWN_SECONDS) {
    return { ok: false, reason: "Cooldown must be at least 5 seconds." };
  }
  const durationMs = seconds * 1000;
  if (!Number.isFinite(durationMs)) {
    return { ok: false, reason: "Cooldown must be a finite number of seconds." };
  }
  return { ok: true, seconds, durationMs };
}

export function selectCooldownDuration(
  state: RuntimeState,
  seconds: number,
): { state: RuntimeState; accepted: boolean; reason: string } {
  const parsed = parseCooldownSeconds(seconds);
  if (!parsed.ok) {
    return { state, accepted: false, reason: parsed.reason };
  }
  return {
    state: {
      ...state,
      cooldownDurationMs: parsed.durationMs,
      session: state.session
        ? { ...state.session, cooldownDurationMs: parsed.durationMs }
        : null,
    },
    accepted: true,
    reason: "Cooldown duration selected.",
  };
}

export function entriesAllowed(phase: RuntimePhase): boolean {
  return phase === "RUNNING";
}

export function paperEntryPermitted(
  phase: RuntimePhase,
  entryPhase: string,
  liveOrdersEnabled: boolean,
): boolean {
  return !liveOrdersEnabled && entriesAllowed(phase) && entryPhase === "ARMED";
}

export function runtimeControls(phase: RuntimePhase): RuntimeControls {
  return {
    run: phase === "STOPPED",
    pause: phase === "RUNNING",
    resume: phase === "PAUSED",
    cooldown: phase === "RUNNING",
    cancelCooldown: phase === "COOLDOWN",
    emergencyStop: phase === "RUNNING" || phase === "PAUSED" || phase === "COOLDOWN",
    clearEmergency: phase === "EMERGENCY_STOPPED",
  };
}

export function dispatchRuntime(
  state: RuntimeState,
  command: RuntimeCommand,
  now: number,
  cooldownMs: number,
): { state: RuntimeState; accepted: boolean; reason: string } {
  void cooldownMs;
  switch (command) {
    case "RUN":
      if (state.phase !== "STOPPED") {
        return reject(state, "RUN only starts a session from STOPPED.");
      }
      return accept(startSession(state, now));
    case "PAUSE":
      if (state.phase !== "RUNNING" || !state.session) {
        return reject(state, "PAUSE only applies to a RUNNING session.");
      }
      return accept(
        withPhase(state, "PAUSED", "SESSION_PAUSED", "Session paused.", now),
      );
    case "RESUME":
      if (state.phase !== "PAUSED" || !state.session) {
        return reject(state, "RESUME only continues a PAUSED session.");
      }
      return accept(
        withPhase(state, "RUNNING", "SESSION_RESUMED", "Session resumed.", now),
      );
    case "COOLDOWN": {
      if (state.phase !== "RUNNING" || !state.session) {
        return reject(state, "COOLDOWN only applies to a RUNNING session.");
      }
      const selected = parseCooldownSeconds(state.session.cooldownDurationMs / 1000);
      if (!selected.ok) {
        return reject(state, selected.reason);
      }
      return accept(startCooldown(state, now, selected.durationMs));
    }
    case "CANCEL_COOLDOWN":
      if (state.phase !== "COOLDOWN" || !state.session) {
        return reject(state, "Cooldown can only be cancelled while it is active.");
      }
      return accept(endCooldown(state, "COOLDOWN_CANCELLED", "Cooldown cancelled.", now));
    case "COOLDOWN_EXPIRED":
      if (state.phase !== "COOLDOWN" || !state.session?.cooldownUntil) {
        return reject(state, "No cooldown is active.");
      }
      if (now < state.session.cooldownUntil) {
        return reject(state, "Cooldown has not expired.");
      }
      return accept(endCooldown(state, "COOLDOWN_EXPIRED", "Cooldown expired.", now));
    case "EMERGENCY_STOP":
      if (!runtimeControls(state.phase).emergencyStop || !state.session) {
        return reject(state, "Emergency stop applies to an active session.");
      }
      return accept(emergencyStop(state, now));
    case "CLEAR_EMERGENCY":
      if (state.phase !== "EMERGENCY_STOPPED" || !state.session) {
        return reject(state, "Emergency stop is not active.");
      }
      return accept(clearEmergency(state, now));
    default:
      return reject(state, "Unknown runtime command.");
  }
}

export function recordSessionTrade(
  state: RuntimeState,
  trade: SessionTradeRecord,
): RuntimeState {
  if (!trade.sessionId || state.trades.some((item) => item.tradeId === trade.tradeId)) {
    return state;
  }
  return {
    ...state,
    trades: [...state.trades, trade],
    journal: appendJournal(state, {
      sessionId: trade.sessionId,
      kind: "PAPER_TRADE_SETTLED",
      message: `Paper trade settled ${trade.won ? "won" : "lost"} on ${trade.symbol}.`,
      at: trade.settledAt,
    }),
  };
}

export function noteRuntime(
  state: RuntimeState,
  kind: JournalKind,
  message: string,
  now: number,
): RuntimeState {
  if (!state.session || state.phase === "STOPPED") {
    return state;
  }
  const lastOfKind = [...state.journal].reverse().find((event) => event.kind === kind);
  if (lastOfKind && lastOfKind.message === message) {
    return state;
  }
  return {
    ...state,
    journal: appendJournal(state, {
      sessionId: state.session.id,
      kind,
      message,
      at: now,
    }),
  };
}

export function sessionPerformance(state: RuntimeState, sessionId: string) {
  const rows = state.trades.filter((trade) => trade.sessionId === sessionId);
  return {
    trades: rows.length,
    wins: rows.filter((trade) => trade.won).length,
    losses: rows.filter((trade) => !trade.won).length,
    profitLoss: rows.reduce((sum, trade) => sum + trade.profitLoss, 0),
  };
}

export function sessionDurationMs(state: RuntimeState, now: number): number {
  if (!state.session) {
    return 0;
  }
  const end = state.session.stoppedAt ?? now;
  return Math.max(0, end - state.session.startedAt);
}

export function blockArmedEntries(
  phase: RuntimePhase,
  decision: EntryDecision,
): EntryDecision {
  if (entriesAllowed(phase) || decision.phase === "PAPER_TRADE_OPEN") {
    return entriesAllowed(phase) ? decision : { ...decision, armed: false };
  }
  if (decision.phase === "ARMED" || decision.armed) {
    return {
      phase: "WATCHING",
      armed: false,
      reason: blockedEntryReason(phase),
    };
  }
  return { ...decision, armed: false };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return hours > 0 ? `${hours}:${clock}` : clock;
}

export function formatClock(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function startSession(state: RuntimeState, now: number): RuntimeState {
  const session: RuntimeSession = {
    id: createSessionId(),
    startedAt: now,
    stoppedAt: null,
    cooldownUntil: null,
    cooldownDurationMs: state.cooldownDurationMs,
  };
  return {
    ...state,
    phase: "RUNNING",
    session,
    journal: [
      ...state.journal,
      journal(session.id, "SESSION_STARTED", "Session started.", now),
      journal(session.id, "ROUTER_SCANNING", "Market Router started scanning.", now),
      journal(session.id, "ENTRY_HUNTER_ACTIVE", "Entry Signal Hunter is active.", now),
    ].slice(-JOURNAL_LIMIT),
  };
}

function startCooldown(state: RuntimeState, now: number, cooldownMs: number): RuntimeState {
  const session = state.session;
  if (!session) {
    return state;
  }
  const nextSession = {
    ...session,
    cooldownDurationMs: cooldownMs,
    cooldownUntil: now + cooldownMs,
  };
  return {
    ...state,
    phase: "COOLDOWN",
    cooldownDurationMs: cooldownMs,
    session: nextSession,
    journal: appendJournal(state, {
      sessionId: session.id,
      kind: "COOLDOWN_STARTED",
      message: "Cooldown started.",
      at: now,
    }),
  };
}

function endCooldown(
  state: RuntimeState,
  kind: "COOLDOWN_CANCELLED" | "COOLDOWN_EXPIRED",
  message: string,
  now: number,
): RuntimeState {
  const session = state.session;
  if (!session) {
    return state;
  }
  return {
    ...state,
    phase: "RUNNING",
    session: { ...session, cooldownUntil: null },
    journal: appendJournal(state, {
      sessionId: session.id,
      kind,
      message,
      at: now,
    }),
  };
}

function emergencyStop(state: RuntimeState, now: number): RuntimeState {
  const session = state.session;
  if (!session) {
    return state;
  }
  return {
    ...state,
    phase: "EMERGENCY_STOPPED",
    session: { ...session, cooldownUntil: null },
    journal: appendJournal(state, {
      sessionId: session.id,
      kind: "EMERGENCY_STOP_ACTIVATED",
      message: "Emergency stop activated.",
      at: now,
    }),
  };
}

function clearEmergency(state: RuntimeState, now: number): RuntimeState {
  const session = state.session;
  if (!session) {
    return state;
  }
  return {
    ...state,
    phase: "STOPPED",
    session: { ...session, stoppedAt: now, cooldownUntil: null },
    journal: appendJournal(
      {
        ...state,
        journal: appendJournal(state, {
          sessionId: session.id,
          kind: "EMERGENCY_STOP_CLEARED",
          message: "Emergency stop cleared.",
          at: now,
        }),
      },
      {
        sessionId: session.id,
        kind: "SESSION_STOPPED",
        message: "Session stopped.",
        at: now,
      },
    ),
  };
}

function withPhase(
  state: RuntimeState,
  phase: RuntimePhase,
  kind: JournalKind,
  message: string,
  now: number,
): RuntimeState {
  const session = state.session;
  if (!session) {
    return state;
  }
  return {
    ...state,
    phase,
    session: { ...session, cooldownUntil: null },
    journal: appendJournal(state, {
      sessionId: session.id,
      kind,
      message,
      at: now,
    }),
  };
}

function appendJournal(
  state: RuntimeState,
  event: RuntimeJournalEvent,
): RuntimeJournalEvent[] {
  return [...state.journal, event].slice(-JOURNAL_LIMIT);
}

function journal(
  sessionId: string,
  kind: JournalKind,
  message: string,
  at: number,
): RuntimeJournalEvent {
  return { sessionId, kind, message, at };
}

function accept(state: RuntimeState) {
  return { state, accepted: true, reason: "Accepted." };
}

function reject(state: RuntimeState, reason: string) {
  return { state, accepted: false, reason };
}

function blockedEntryReason(phase: RuntimePhase): string {
  switch (phase) {
    case "PAUSED":
      return "Session is paused. New entries are blocked.";
    case "COOLDOWN":
      return "Cooldown is active. New entries are blocked.";
    case "EMERGENCY_STOPPED":
      return "Emergency stop is active. New entries are blocked.";
    default:
      return "Runtime is stopped. New entries are blocked.";
  }
}

function createSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `paper-${uuid}`;
  }
  return `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
