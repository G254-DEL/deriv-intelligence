import type { EntryDecision } from "@/src/lib/trading/entry-signal";
import type { RankedOpportunity } from "@/src/lib/trading/master-bot";
import { SPECIALIST_BOTS } from "@/src/lib/trading/master-bot";
import type { BotStrategy, PaperTrade } from "@/src/lib/trading/types";
import type { MarketTickSnapshot } from "@/src/lib/deriv";
import { BotStatusBadge } from "@/components/bots/BotStatusBadge";

export function ActiveBotPanel({
  assigned,
  marketTicks,
  allowedStrategies,
  openPaperTrade,
  cooldown,
  entries,
}: {
  assigned: Record<BotStrategy, RankedOpportunity | null>;
  marketTicks: Record<string, MarketTickSnapshot>;
  allowedStrategies: ReadonlySet<BotStrategy>;
  openPaperTrade: PaperTrade | null;
  cooldown: boolean;
  entries?: Partial<Record<BotStrategy, EntryDecision>>;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Active bot control
        </p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">
          Specialist operations
        </h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {SPECIALIST_BOTS.map((bot) => {
          const slot = assigned[bot.id];
          const tick = slot ? marketTicks[slot.symbol] : undefined;
          const enabled = allowedStrategies.has(bot.id);
          const open = openPaperTrade?.strategy === bot.id;
          const entry = entries?.[bot.id];
          const status = entry?.phase ?? presentationStatus({
            enabled,
            slot,
            open,
            cooldown,
          });
          return (
            <article
              key={bot.id}
              className={`rounded-2xl border bg-[#151a22] p-4 ${
                enabled ? "border-border" : "border-border/50 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{bot.label}</h3>
                <BotStatusBadge
                  label={status}
                  tone={
                    open || entry?.phase === "PAPER_TRADE_OPEN"
                      ? "paper"
                      : entry?.phase === "ARMED"
                        ? "armed"
                        : "idle"
                  }
                />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Field label="Assigned market" value={slot?.marketName ?? "—"} />
                <Field label="Current tick" value={tick?.formattedPrice ?? "—"} />
                <Field label="Current digit" value={tick?.digit ?? "—"} />
                <Field
                  label="Confidence"
                  value={
                    slot ? `${(slot.confidence * 100).toFixed(1)}%` : "—"
                  }
                />
                <Field label="Sample" value={slot ? String(slot.sampleSize) : "—"} />
                <Field
                  label="Probability"
                  value={
                    slot?.probability === undefined
                      ? "—"
                      : `${(slot.probability * 100).toFixed(1)}%`
                  }
                />
                <Field label="Signal" value={status} />
                <Field label="Why" value={entry?.reason ?? slot?.reason ?? "—"} />
                <Field
                  label="Paper position"
                  value={open ? "OPEN" : "None"}
                />
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function presentationStatus({
  enabled,
  slot,
  open,
  cooldown,
}: {
  enabled: boolean;
  slot: RankedOpportunity | null;
  open: boolean;
  cooldown: boolean;
}): string {
  if (!enabled) {
    return "IDLE";
  }
  if (open) {
    return "PAPER TRADE OPEN";
  }
  if (cooldown) {
    return "COOLDOWN";
  }
  if (slot?.ready) {
    return "ARMED";
  }
  if (slot) {
    return "WATCHING";
  }
  return "IDLE";
}
