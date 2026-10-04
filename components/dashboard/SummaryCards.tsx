type SummaryCardsProps = {
  live: boolean;
  activeMarkets: number;
  liveTicks: number;
  setupsDetected: number;
  entrySignals: number;
};

export function SummaryCards({
  live,
  activeMarkets,
  liveTicks,
  setupsDetected,
  entrySignals,
}: SummaryCardsProps) {
  const cards = [
    {
      title: "Active Markets",
      value: String(activeMarkets),
      detail: live
        ? `${liveTicks} live tick stream${liveTicks === 1 ? "" : "s"}`
        : "Waiting for the public Deriv stream",
    },
    {
      title: "Setups Detected",
      value: String(setupsDetected),
      detail: live
        ? "Monitoring or signal after 10 ticks"
        : "No live scanner sample yet",
    },
    {
      title: "Entry Signals",
      value: live ? String(entrySignals) : "None",
      detail: live
        ? "Digit-bias signals on watched markets"
        : "Not a live signal feed until connected",
    },
    {
      title: "Bot Status",
      value: "Idle",
      detail: "Automatic trading stays off",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article
          key={card.title}
          className="rounded-lg border border-border bg-surface px-4 py-4"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
              {card.title}
            </p>
            <span className="text-[10px] uppercase tracking-wide text-warning">
              {live ? "Live" : "Offline"}
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
