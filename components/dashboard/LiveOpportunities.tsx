import { Card } from "@/components/ui/Card";
import type { DashboardOpportunity } from "@/components/dashboard/useDashboardLiveFeed";
import type { DerivConnectionState } from "@/src/lib/deriv";

type LiveOpportunitiesProps = {
  live: boolean;
  connectionState: DerivConnectionState;
  rows: DashboardOpportunity[];
};

export function LiveOpportunities({
  live,
  connectionState,
  rows,
}: LiveOpportunitiesProps) {
  return (
    <Card title="Live Opportunities" badge={live ? "Live" : "Offline"}>
      <p className="mb-4 text-sm text-muted">
        Digit-bias state from public ticks on watched markets. These are not
        trade recommendations and do not place orders.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted">
              <th className="pb-3 pr-4 font-medium">Market</th>
              <th className="pb-3 pr-4 font-medium">Strategy</th>
              <th className="pb-3 pr-4 font-medium">Current Digit</th>
              <th className="pb-3 pr-4 font-medium">Entry State</th>
              <th className="pb-3 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-muted">
                  {emptyDetail(connectionState)}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.symbol} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 text-foreground">{row.market}</td>
                  <td className="py-3 pr-4 text-foreground">{row.strategy}</td>
                  <td className="py-3 pr-4 font-mono text-muted">
                    {row.currentDigit}
                  </td>
                  <td className="py-3 pr-4 text-muted">{row.entryState}</td>
                  <td className="py-3 text-muted">{row.lastUpdated}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function emptyDetail(state: DerivConnectionState): string {
  if (state === "connecting") {
    return "Connecting to public Deriv market data.";
  }
  if (state === "error") {
    return "Market data connection error. The dashboard will retry.";
  }
  if (state !== "connected") {
    return "Waiting for the public Deriv stream before listing markets.";
  }
  return "No watched markets are available yet.";
}
