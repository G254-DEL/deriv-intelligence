import type { RouterTableRow } from "@/src/lib/trading/run-cycle";

export function MarketRouterPanel({
  discovered,
  subscribed,
  sufficient,
  qualified,
  assignments,
  openPositions,
  rows,
}: {
  discovered: number;
  subscribed: number;
  sufficient: number;
  qualified: number;
  assignments: number;
  openPositions: number;
  rows: RouterTableRow[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#141922]">
      <div className="border-b border-cyan-400/15 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
          Market Router
        </p>
        <p className="mt-1 text-sm text-muted">
          Live qualified market and specialist rankings. A row is an assignment, not a trade.
        </p>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Markets discovered" value={String(discovered)} />
        <Metric label="Markets subscribed" value={String(subscribed)} />
        <Metric label="Markets with sufficient samples" value={String(sufficient)} />
        <Metric label="Qualified opportunities" value={String(qualified)} />
        <Metric label="Active assignments" value={String(assignments)} />
        <Metric label="Open paper positions" value={String(openPositions)} />
      </div>
      <div className="overflow-x-auto px-5 pb-5">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted">
              <th className="pb-3 pr-3 font-medium">Rank</th>
              <th className="pb-3 pr-3 font-medium">Market</th>
              <th className="pb-3 pr-3 font-medium">Specialist</th>
              <th className="pb-3 pr-3 font-medium">Prob</th>
              <th className="pb-3 pr-3 font-medium">Edge</th>
              <th className="pb-3 pr-3 font-medium">Sample</th>
              <th className="pb-3 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-muted">
                  Collecting samples. Unqualified markets are not ranked.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={`${row.symbol}-${row.strategy}`}
                  className="border-b border-border last:border-0"
                  title={`${row.reason}. Baseline ${(row.fairProbability * 100).toFixed(1)}%. Adjustment ${row.performanceAdjustment.toFixed(3)}. Score ${row.score.toFixed(4)}.`}
                >
                  <td className="py-3 pr-3 font-mono text-foreground">{row.rank}</td>
                  <td className="py-3 pr-3 text-foreground">{row.symbol}</td>
                  <td className="py-3 pr-3 text-foreground">{row.specialist}</td>
                  <td className="py-3 pr-3 font-mono text-muted">
                    {(row.probability * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 pr-3 font-mono text-muted">
                    {row.edge >= 0 ? "+" : ""}
                    {(row.edge * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 pr-3 font-mono text-muted">{row.sampleSize}</td>
                  <td className="py-3 text-muted">{row.state}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/80 bg-black/20 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
