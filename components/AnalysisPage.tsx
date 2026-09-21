"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  retainPublicMarketData,
  type DerivConnectionState,
  type DerivTick,
} from "@/src/lib/deriv";
import { analyzeDigitBias } from "@/src/lib/strategy/digit-bias";

export default function AnalysisPage() {
  const [connectionState, setConnectionState] =
    useState<DerivConnectionState>("disconnected");
  const [ticks, setTicks] = useState<DerivTick[]>([]);

  useEffect(() => {
    const session = retainPublicMarketData({
      onConnectionChange: (state, detail) => {
        setConnectionState(state);
        if (state !== "connected") setTicks([]);
      },
      onTick: (snapshot) => {
        setTicks((current) => [...current, snapshot].slice(-50));
      },
    });

    return () => session.release();
  }, []);

  const analysis = useMemo(
    () => analyzeDigitBias(ticks.map((tick) => Number(String(tick.quote).slice(-1))).filter(
      (digit): digit is number => typeof digit === "number"
    )),
    [ticks]
  );

  const latest = ticks[ticks.length - 1];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Market Analysis</h1>
        <p className="mt-1 text-sm text-muted">
          Live market data analysis using the same public Deriv stream as the Scanner.
        </p>
      </div>

      <Card title="Live Market Status" badge={connectionState.toUpperCase()}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-4">
            <div className="text-sm text-muted">Connection</div>
            <div className="mt-1 font-semibold">{connectionState}</div>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="text-sm text-muted">Latest Price</div>
            <div className="mt-1 font-semibold">
              {latest?.quote ?? "—"}
            </div>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="text-sm text-muted">Current Digit</div>
            <div className="mt-1 text-2xl font-semibold">
            {latest ? String(latest.quote).slice(-1) : "-"}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Digit Bias" badge={analysis.state}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-4">
            <div className="text-sm text-muted">Dominant Digit</div>
            <div className="mt-1 text-2xl font-semibold">
              {analysis.dominantDigit ?? "—"}
            </div>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="text-sm text-muted">Dominant Frequency</div>
            <div className="mt-1 text-2xl font-semibold">
              {analysis.dominantFrequency !== null
                ? `${(analysis.dominantFrequency * 100).toFixed(1)}%`
                : "—"}
            </div>
          </div>

          <div className="rounded-md border border-border p-4">
            <div className="text-sm text-muted">Sample Size</div>
            <div className="mt-1 text-2xl font-semibold">
              {analysis.sampleSize}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Analysis Summary">
        <p className="text-sm text-muted">
          The analysis engine continuously evaluates the latest live tick
          sample and reports whether the current digit distribution is still
          collecting data, monitoring, or has reached the configured signal
          threshold.
        </p>
      </Card>
    </div>
  );
}







