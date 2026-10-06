import type { PaperTrade } from "@/src/lib/trading/types";
import {
  formatClock,
  formatDuration,
  runtimeControls,
  sessionDurationMs,
  sessionPerformance,
  type RuntimeCommand,
  type RuntimeState,
} from "@/src/lib/trading/runtime-session";

export function RuntimeControlBar({
  state,
  now,
  candidate,
  specialist,
  signalState,
  markets,
  openPositions,
  cooldownSeconds,
  cooldownError,
  onCooldownSecondsChange,
  onCommand,
}: {
  state: RuntimeState;
  now: number;
  candidate: string;
  specialist: string;
  signalState: string;
  markets: number;
  openPositions: PaperTrade[];
  cooldownSeconds: string;
  cooldownError: string | null;
  onCooldownSecondsChange: (seconds: string) => void;
  onCommand: (command: RuntimeCommand) => void;
}) {
  const controls = runtimeControls(state.phase);
  const sessionId = state.session?.id ?? null;
  const stats = sessionId ? sessionPerformance(state, sessionId) : emptyStats;
  const remaining =
    state.phase === "COOLDOWN" && state.session?.cooldownUntil
      ? Math.max(0, state.session.cooldownUntil - now)
      : 0;

  return (
    <section className="rounded-2xl border border-cyan-400/25 bg-[#121820] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
            Bot runtime <span className="ml-2 text-warning">Paper</span>
          </p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-foreground">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${phaseDot(state.phase)}`}
              aria-hidden
            />
            {state.phase === "EMERGENCY_STOPPED" ? "EMERGENCY STOPPED" : state.phase}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ControlButton
            label="▶ RUN"
            enabled={controls.run}
            onClick={() => onCommand("RUN")}
            tone="primary"
          />
          <ControlButton
            label="⏸ PAUSE"
            enabled={controls.pause}
            onClick={() => onCommand("PAUSE")}
          />
          <ControlButton
            label="▶ RESUME"
            enabled={controls.resume}
            onClick={() => onCommand("RESUME")}
          />
          <label className="flex items-center gap-2 rounded-xl border border-border bg-[#151a22] px-3 py-2 text-sm text-muted">
            Cooldown:
            <input
              type="number"
              min={5}
              step="any"
              inputMode="decimal"
              aria-label="Cooldown seconds"
              value={cooldownSeconds}
              onChange={(event) => onCooldownSecondsChange(event.target.value)}
              className="w-24 rounded-md border border-border bg-[#0e131a] px-2 py-1 text-foreground"
            />
            seconds
          </label>
          <ControlButton
            label={controls.cancelCooldown ? "⏱ Cancel cooldown" : "⏱ COOLDOWN"}
            enabled={controls.cooldown || controls.cancelCooldown}
            onClick={() => onCommand(controls.cancelCooldown ? "CANCEL_COOLDOWN" : "COOLDOWN")}
          />
          <ControlButton
            label="⛔ EMERGENCY STOP"
            enabled={controls.emergencyStop}
            onClick={() => onCommand("EMERGENCY_STOP")}
            tone="danger"
          />
          <ControlButton
            label="Clear stop"
            enabled={controls.clearEmergency}
            onClick={() => onCommand("CLEAR_EMERGENCY")}
          />
        </div>
      </div>
      {cooldownError ? <p className="mt-3 text-sm text-warning">{cooldownError}</p> : null}
      {state.phase === "COOLDOWN" ? (
        <p className="mt-3 text-sm text-warning">Cooldown {formatDuration(remaining)} remaining</p>
      ) : null}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Session duration" value={formatDuration(sessionDurationMs(state, now))} />
        <Stat label="Master state" value={state.phase} />
        <Stat label="Markets monitored" value={String(markets)} />
        <Stat label="Current candidate" value={candidate} />
        <Stat label="Assigned specialist" value={specialist} />
        <Stat label="Signal state" value={signalState} />
        <Stat
          label="Open paper positions"
          value={
            openPositions.length === 0
              ? "None"
              : openPositions.map((trade) => `${trade.strategy} ${trade.symbol}`).join(", ")
          }
        />
        <Stat label="Session trades" value={String(stats.trades)} />
        <Stat label="Wins" value={String(stats.wins)} />
        <Stat label="Losses" value={String(stats.losses)} />
        <Stat label="Session P/L" value={stats.profitLoss.toFixed(2)} />
      </dl>
      <div className="mt-4 max-h-36 overflow-y-auto rounded-xl border border-border bg-[#0e131a] px-3 py-2">
        {state.journal.length === 0 ? (
          <p className="text-sm text-muted">Runtime journal is empty.</p>
        ) : (
          <ul className="space-y-1 text-sm text-foreground">
            {state.journal.slice(-8).map((event) => (
              <li key={`${event.at}-${event.kind}-${event.message}`}>
                <span className="mr-2 font-mono text-xs text-muted">{formatClock(event.at)}</span>
                {event.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ControlButton({
  label,
  enabled,
  onClick,
  tone = "default",
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
  tone?: "default" | "primary" | "danger";
}) {
  const toneClass =
    tone === "primary"
      ? "border-cyan-300/50 bg-cyan-400/15"
      : tone === "danger"
        ? "border-red-400/50 bg-red-500/10"
        : "border-border bg-[#151a22]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      className={`rounded-xl border px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted ${toneClass}`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 truncate text-foreground">{value}</dd>
    </div>
  );
}

function phaseDot(phase: RuntimeState["phase"]): string {
  switch (phase) {
    case "RUNNING":
      return "bg-emerald-400";
    case "PAUSED":
      return "bg-amber-300";
    case "COOLDOWN":
      return "bg-sky-300";
    case "EMERGENCY_STOPPED":
      return "bg-red-400";
    default:
      return "bg-muted";
  }
}

const emptyStats = { trades: 0, wins: 0, losses: 0, profitLoss: 0 };
