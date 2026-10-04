import { Card } from "@/components/ui/Card";
import type { DashboardOpportunity } from "@/components/dashboard/useDashboardLiveFeed";

type EntryMapPreviewProps = {
  live: boolean;
  featured: DashboardOpportunity | null;
};

export function EntryMapPreview({ live, featured }: EntryMapPreviewProps) {
  const rows = featured
    ? [
        { label: "Market", value: featured.market },
        { label: "Strategy", value: featured.strategy },
        {
          label: "Trigger Digit",
          value:
            featured.dominantDigit !== null
              ? String(featured.dominantDigit)
              : "Collecting",
        },
        {
          label: "Confirmation",
          value:
            featured.dominantFrequency !== null
              ? `${(featured.dominantFrequency * 100).toFixed(1)}% of ${featured.sampleSize} ticks`
              : `${featured.sampleSize}/10 ticks`,
        },
        { label: "Current State", value: featured.entryState },
      ]
    : [
        { label: "Strategy", value: "Digit Bias" },
        { label: "Trigger Digit", value: "—" },
        { label: "Confirmation", value: "Waiting for ticks" },
        { label: "Current State", value: live ? "No featured market" : "Offline" },
      ];

  return (
    <Card title="Entry Map" badge={live ? "Live" : "Offline"}>
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="rounded-md border border-border bg-surface-raised px-3 py-3"
          >
            <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">
              {row.label}
            </dt>
            <dd className="mt-1 font-mono text-sm text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm leading-6 text-muted">
        Entry maps show digit-bias conditions on the public feed. They do not
        guarantee the next tick and do not place orders.
      </p>
    </Card>
  );
}
