import type { EntryDecision } from "@/src/lib/trading/entry-signal";
import type { RankedOpportunity } from "@/src/lib/trading/master-bot";
import { SPECIALIST_BOTS } from "@/src/lib/trading/master-bot";
import type { BotStrategy, PaperTrade } from "@/src/lib/trading/types";
import type { MarketTickSnapshot } from "@/src/lib/deriv";
import { BotStatusBadge } from "@/components/bots/BotStatusBadge";

const SPECIALIST_CARD_ORDER: BotStrategy[] = [
  "UNDER_7",
  "UNDER_8",
  "OVER_2",
  "OVER_3",
  "EVEN_ODD",
];

export function ActiveBotPanel({
  assigned,
  marketTicks,
  allowedStrategies,
  openPositions,
  assignmentCounts,
  cooldown,
  entries,
}: {
  assigned: Record<BotStrategy, RankedOpportunity | null>;
  marketTicks: Record<string, MarketTickSnapshot>;
  allowedStrategies: ReadonlySet<BotStrategy>;
  openPositions: PaperTrade[];
  assignmentCounts?: Partial<Record<BotStrategy, number>>;
  cooldown: boolean;
  entries?: Partial<Record<BotStrategy, EntryDecision>>;
}) {
  const bots = [...SPECIALIST_BOTS].sort(
    (a, b) =>
      SPECIALIST_CARD_ORDER.indexOf(a.id) - SPECIALIST_CARD_ORDER.indexOf(b.id),
  );

  return (
    <section className="flex flex-col gap-4">
      <style>{`
        .specialist-ops-grid {
          display: grid;
          width: 100%;
          max-width: 360px;
          min-width: 0;
          align-items: start;
          justify-content: start;
          gap: 16px;
          grid-template-columns: minmax(0, 1fr);
        }
        .specialist-ops-card {
          width: 100%;
          max-width: 360px;
          min-width: 0;
          box-sizing: border-box;
          padding: 16px;
        }
        .specialist-ops-body {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 12px;
        }
        .specialist-ops-metrics {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          column-gap: 12px;
          row-gap: 10px;
        }
        .specialist-ops-label {
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .specialist-ops-value {
          margin-top: 2px;
          font-size: 0.875rem;
          line-height: 1.2;
          font-weight: 500;
          color: var(--foreground);
          overflow-wrap: anywhere;
        }
        .specialist-ops-clamp {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        @media (min-width: 768px) {
          .specialist-ops-grid {
            max-width: 736px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (min-width: 1280px) {
          .specialist-ops-grid {
            max-width: 1112px;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      `}</style>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Active bot control
        </p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">
          Specialist operations
        </h2>
      </div>
      <div className="specialist-ops-grid">
        {bots.map((bot) => {
          const slot = assigned[bot.id];
          const tick = slot ? marketTicks[slot.symbol] : undefined;
          const enabled = allowedStrategies.has(bot.id);
          const opens = openPositions.filter((trade) => trade.strategy === bot.id);
          const open = opens.length > 0;
          const extraMarkets = Math.max(0, (assignmentCounts?.[bot.id] ?? (slot ? 1 : 0)) - (slot ? 1 : 0));
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
              className={`specialist-ops-card rounded-2xl border bg-[#151a22] ${
                enabled ? "border-border" : "border-border/50 opacity-70"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold leading-none text-foreground">
                  {bot.label}
                </h3>
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
              <div className="specialist-ops-body">
                <Field
                  label="Assigned Market"
                  value={
                    slot
                      ? extraMarkets > 0
                        ? `${slot.marketName} +${extraMarkets}`
                        : slot.marketName
                      : "—"
                  }
                  clamp
                />
                <div className="specialist-ops-metrics">
                  <Field label="Current Tick" value={tick?.formattedPrice ?? "—"} />
                  <Field label="Current Digit" value={tick?.digit ?? "—"} />
                  <Field
                    label="Confidence"
                    value={
                      slot ? `${(slot.confidence * 100).toFixed(1)}%` : "—"
                    }
                  />
                  <Field
                    label="Probability"
                    value={
                      slot?.probability === undefined
                        ? "—"
                        : `${(slot.probability * 100).toFixed(1)}%`
                    }
                  />
                  <Field label="Sample" value={slot ? String(slot.sampleSize) : "—"} />
                  <Field label="Signal" value={status} />
                </div>
                <Field
                  label="Why"
                  value={entry?.reason ?? slot?.reason ?? "—"}
                  clamp
                />
                <Field
                  label="Paper Position"
                  value={open ? opens.map((trade) => trade.symbol).join(", ") : "None"}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  clamp = false,
}: {
  label: string;
  value: string;
  clamp?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="specialist-ops-label">{label}</div>
      <div
        className={`specialist-ops-value${clamp ? " specialist-ops-clamp" : ""}`}
        title={clamp ? value : undefined}
      >
        {value}
      </div>
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
