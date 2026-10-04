"use client";

import { BotStatusPanel } from "@/components/dashboard/BotStatusPanel";
import { EntryMapPreview } from "@/components/dashboard/EntryMapPreview";
import { LiveOpportunities } from "@/components/dashboard/LiveOpportunities";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { useDashboardLiveFeed } from "@/components/dashboard/useDashboardLiveFeed";
import { connectionLabel, type DerivConnectionState } from "@/src/lib/deriv";

const STATUS_DOT: Record<DerivConnectionState, string> = {
  connected: "bg-accent",
  connecting: "bg-warning",
  disconnected: "bg-muted",
  error: "bg-warning",
};

export function DashboardView() {
  const feed = useDashboardLiveFeed();
  const live = feed.connectionState === "connected";

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
        <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[feed.connectionState]}`}
            aria-hidden
          />
          <span className={live ? "text-foreground" : "text-warning"}>
            {live
              ? "Public market data · live"
              : connectionLabel(feed.connectionState).replace(
                  "Deriv Market Data: ",
                  "",
                )}
          </span>
        </div>
      </div>

      {feed.statusDetail && feed.connectionState !== "connected" ? (
        <p className="text-sm text-muted">{feed.statusDetail}</p>
      ) : (
        <p className="text-sm leading-6 text-muted">
          This overview uses the public Deriv market-data stream. Account sign-in
          is separate. Paper trading and automatic orders stay off from this page.
        </p>
      )}

      <SummaryCards
        live={live}
        activeMarkets={feed.activeMarketCount}
        liveTicks={feed.liveTickCount}
        setupsDetected={feed.setupsDetected}
        entrySignals={feed.entrySignals}
      />
      <LiveOpportunities
        live={live}
        connectionState={feed.connectionState}
        rows={feed.opportunities}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <EntryMapPreview live={live} featured={feed.featured} />
        <BotStatusPanel
          live={live}
          connectionState={feed.connectionState}
        />
      </div>
    </div>
  );
}
