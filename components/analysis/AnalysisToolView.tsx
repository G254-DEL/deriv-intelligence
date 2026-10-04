"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { DigitMeter } from "@/components/market/DigitMeter";
import { useMarketDigitSample } from "@/components/market/useMarketDigitSample";
import { connectionLabel } from "@/src/lib/deriv";

const SAMPLE_SIZES = [100, 500, 1000] as const;

export function AnalysisToolView() {
  const [count, setCount] = useState<(typeof SAMPLE_SIZES)[number]>(1000);
  const [mode, setMode] = useState<"even-odd" | "over-under">("even-odd");
  const [barrier, setBarrier] = useState(7);
  const sample = useMarketDigitSample(count);

  const marketName =
    sample.symbols.find((item) => item.underlying_symbol === sample.symbol)
      ?.underlying_symbol_name ?? sample.symbol;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Analysis tool
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Last {sample.digits.length} ticks
          </h2>
        </div>
        <p className="text-xs text-muted">
          {connectionLabel(sample.connectionState)}
        </p>
      </div>

      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground">
        Digit map from public ticks plus history. This is not a trade
        recommendation and does not place orders.
      </p>

      <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
            Market
          </span>
          <select
            value={sample.symbol}
            onChange={(event) => sample.setSymbol(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {sample.symbols.map((item) => (
              <option key={item.underlying_symbol} value={item.underlying_symbol}>
                {item.underlying_symbol_name ?? item.underlying_symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted">
            Ticks
          </span>
          <select
            value={count}
            onChange={(event) =>
              setCount(Number(event.target.value) as (typeof SAMPLE_SIZES)[number])
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {SAMPLE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Card title={marketName} badge="Live sample">
        <p className="mb-6 font-mono text-4xl font-semibold tracking-tight text-foreground">
          {sample.latest?.formattedPrice ?? "—"}
        </p>
        {sample.historyError ? (
          <p className="mb-4 text-sm text-warning">{sample.historyError}</p>
        ) : null}
        <div className="mb-5 flex flex-wrap gap-2">
          <Toggle
            label="Even / Odd"
            active={mode === "even-odd"}
            onClick={() => setMode("even-odd")}
          />
          <Toggle
            label="Over / Under"
            active={mode === "over-under"}
            onClick={() => setMode("over-under")}
          />
          {mode === "over-under" ? (
            <select
              value={barrier}
              onChange={(event) => setBarrier(Number(event.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {[2, 3, 7, 8].map((value) => (
                <option key={value} value={value}>
                  Barrier {value}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <DigitMeter digits={sample.digits} mode={mode} overUnderBarrier={barrier} />
      </Card>
    </div>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm ${
        active
          ? "border-border bg-surface-raised text-foreground"
          : "border-border text-muted"
      }`}
    >
      {label}
    </button>
  );
}
