import type { RankedOpportunity } from "@/src/lib/trading/master-bot";
import type { BotStrategy, PaperTrade } from "@/src/lib/trading/types";
import { SPECIALIST_BOTS } from "@/src/lib/trading/master-bot";

export function MasterControlPanel({
  roleTitle,
  statusLabel,
  connectionLabel,
  recoveryReason,
  recoveryMode,
  marketsScanned,
  ranked,
  assigned,
  profitLoss,
  wins,
  losses,
  openPositions,
}: {
  roleTitle: string;
  statusLabel: string;
  connectionLabel: string;
  recoveryReason: string;
  recoveryMode: boolean;
  marketsScanned: number;
  ranked: RankedOpportunity[];
  assigned: Record<BotStrategy, RankedOpportunity | null>;
  profitLoss: number;
  wins: number;
  losses: number;
  openPositions: PaperTrade[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#141922]">
      <div className="border-b border-cyan-400/15 bg-gradient-to-r from-cyan-500/15 to-transparent px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
          Master control
        </p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">{roleTitle}</h2>
        <p className="mt-1 text-sm text-muted">{recoveryReason}</p>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Master status" value={statusLabel} />
        <Metric label="Market data" value={connectionLabel} />
        <Metric label="Markets scanned" value={String(marketsScanned)} />
        <Metric label="Risk / recovery" value={recoveryMode ? "Recovery" : "Normal"} />
        <Metric label="Paper P/L" value={profitLoss.toFixed(2)} />
        <Metric label="Wins / Losses" value={`${wins} / ${losses}`} />
        <Metric
          label="Open paper positions"
          value={
            openPositions.length === 0
              ? "None"
              : openPositions.map((trade) => trade.symbol).join(", ")
          }
        />
        <Metric
          label="Assigned specialists"
          value={String(SPECIALIST_BOTS.filter((bot) => assigned[bot.id]).length)}
        />
      </div>
      <div className="overflow-x-auto px-5 pb-5">
        <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted">
          Best opportunities
        </p>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted">
              <th className="pb-3 pr-4 font-medium">Market</th>
              <th className="pb-3 pr-4 font-medium">Fit</th>
              <th className="pb-3 pr-4 font-medium">Digit</th>
              <th className="pb-3 pr-4 font-medium">Confidence</th>
              <th className="pb-3 font-medium">Ready</th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-muted">
                  Waiting for synthetic tick samples.
                </td>
              </tr>
            ) : (
              ranked.slice(0, 10).map((row) => (
                <tr
                  key={`${row.symbol}-${row.strategy}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-3 pr-4 text-foreground">{row.marketName}</td>
                  <td className="py-3 pr-4 text-foreground">
                    {SPECIALIST_BOTS.find((item) => item.id === row.strategy)?.label ??
                      row.strategy}
                  </td>
                  <td className="py-3 pr-4 font-mono text-muted">{row.dominantDigit}</td>
                  <td className="py-3 pr-4 font-mono text-muted">
                    {(row.confidence * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 text-muted">{row.ready ? "SIGNAL" : "WATCHING"}</td>
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
