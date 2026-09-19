import { Card } from "@/components/ui/Card";
import { DEMO_LABEL, liveOpportunities } from "@/lib/demo-data";

export function LiveOpportunities() {
  return (
    <Card title="Live Opportunities" badge={DEMO_LABEL}>
      <p className="mb-4 text-sm text-muted">
        Example rows for layout only. These are not live opportunities and are
        not trade recommendations.
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
            {liveOpportunities.map((row) => (
              <tr key={row.market} className="border-b border-border last:border-0">
                <td className="py-3 pr-4 text-foreground">{row.market}</td>
                <td className="py-3 pr-4 text-foreground">{row.strategy}</td>
                <td className="py-3 pr-4 font-mono text-muted">{row.currentDigit}</td>
                <td className="py-3 pr-4 text-muted">{row.entryState}</td>
                <td className="py-3 text-muted">{row.lastUpdated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
