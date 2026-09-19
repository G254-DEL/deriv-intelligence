import { DEMO_LABEL, summaryCards } from "@/lib/demo-data";

export function SummaryCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {summaryCards.map((card) => (
        <article
          key={card.title}
          className="rounded-lg border border-border bg-surface px-4 py-4"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
              {card.title}
            </p>
            <span className="text-[10px] uppercase tracking-wide text-warning">
              {DEMO_LABEL}
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            {card.value}
          </p>
          <p className="mt-1 text-xs text-muted">{card.detail}</p>
        </article>
      ))}
    </div>
  );
}
