import { Card } from "@/components/ui/Card";

export function StrategiesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted">Strategy Engine</p>
        <h1 className="mt-2 text-3xl font-semibold text-foreground">Strategies</h1>
        <p className="mt-2 text-sm text-muted">
          Define and monitor the rules used by the market scanner.
        </p>
      </div>

      <Card title="Active Strategy" badge="LIVE">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Digit Bias</h2>
            <p className="mt-1 text-sm text-muted">
              Detects when one last digit appears more frequently than the
              configured threshold in the recent tick sample.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-md border border-border p-4">
              <div className="text-xs uppercase tracking-wider text-muted">Sample</div>
              <div className="mt-2 text-lg font-semibold text-foreground">20 ticks</div>
            </div>

            <div className="rounded-md border border-border p-4">
              <div className="text-xs uppercase tracking-wider text-muted">Signal threshold</div>
              <div className="mt-2 text-lg font-semibold text-foreground">≥ 20%</div>
            </div>

            <div className="rounded-md border border-border p-4">
              <div className="text-xs uppercase tracking-wider text-muted">States</div>
              <div className="mt-2 text-lg font-semibold text-foreground">3</div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Entry States">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-4">
            <div className="font-semibold text-foreground">COLLECTING</div>
            <p className="mt-1 text-sm text-muted">Fewer than 10 valid ticks.</p>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="font-semibold text-foreground">MONITORING</div>
            <p className="mt-1 text-sm text-muted">
              At least 10 ticks, but no digit reaches 20%.
            </p>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="font-semibold text-foreground">SIGNAL</div>
            <p className="mt-1 text-sm text-muted">
              At least 10 ticks and a dominant digit reaches 20%.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Strategy Status" badge="PLANNED">
        <p className="text-sm text-muted">
          Additional strategies, configurable rules, backtesting, and paper
          trading controls will be added here in later stages.
        </p>
      </Card>
    </div>
  );
}
