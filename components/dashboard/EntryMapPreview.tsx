import { Card } from "@/components/ui/Card";
import { DEMO_LABEL, entryMapPreview } from "@/lib/demo-data";

const rows = [
  { label: "Strategy", value: entryMapPreview.strategy },
  { label: "Trigger Digit", value: entryMapPreview.triggerDigit },
  { label: "Confirmation", value: entryMapPreview.confirmation },
  { label: "Current State", value: entryMapPreview.currentState },
];

export function EntryMapPreview() {
  return (
    <Card title="Entry Map" badge={DEMO_LABEL}>
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
        Entry maps define the conditions that must occur before a strategy can
        generate an entry signal. They do not guarantee the next market outcome.
      </p>
    </Card>
  );
}
