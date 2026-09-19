import { BotStatusPanel } from "@/components/dashboard/BotStatusPanel";
import { EntryMapPreview } from "@/components/dashboard/EntryMapPreview";
import { LiveOpportunities } from "@/components/dashboard/LiveOpportunities";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { UI_PREVIEW_LABEL } from "@/lib/demo-data";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Overview
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Dashboard
          </h2>
        </div>
        <p className="rounded-md border border-border px-2.5 py-1 text-xs text-warning">
          {UI_PREVIEW_LABEL} · not connected to Deriv
        </p>
      </div>

      <SummaryCards />
      <LiveOpportunities />

      <div className="grid gap-5 xl:grid-cols-2">
        <EntryMapPreview />
        <BotStatusPanel />
      </div>
    </div>
  );
}
