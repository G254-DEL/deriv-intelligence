"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { DigitMeter } from "@/components/market/DigitMeter";
import { useMarketDigitSample } from "@/components/market/useMarketDigitSample";
import { connectionLabel } from "@/src/lib/deriv";
import { DEFAULT_RISK_CONFIG } from "@/src/lib/trading/risk";
import {
  closeControlledPaperTrade,
  openControlledPaperTrade,
} from "@/src/lib/trading/controller";
import { createTradingSession, type TradingSession } from "@/src/lib/trading/session";
import type { PaperTrade } from "@/src/lib/trading/types";
import { paperProposalRequest, parseProposalQuote } from "@/src/lib/trading/proposal";
import type { PaperProposalClient } from "@/src/lib/trading/open-quoted-paper-trade";

const LIVE_ORDERS_ENABLED = false;
const MAX_BULK = 10;

type Phase = "idle" | "armed" | "open";

export function BulkTraderView() {
  const sample = useMarketDigitSample(100);
  const [side, setSide] = useState<"EVEN" | "ODD">("EVEN");
  const [stake, setStake] = useState(0.5);
  const [bulkCount, setBulkCount] = useState(10);
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<TradingSession>(createTradingSession);
  const [openTrades, setOpenTrades] = useState<PaperTrade[]>([]);
  const [notice, setNotice] = useState("Choose Even or Odd to paper-open after the next tick.");
  const sessionRef = useRef(session);
  const phaseRef = useRef(phase);
  const openRef = useRef<PaperTrade[]>([]);
  const lastEpochRef = useRef<number | null>(null);
  const entryEpochRef = useRef<number | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    openRef.current = openTrades;
  }, [openTrades]);

  const latest = sample.latest;
  const latestEpoch = latest?.epoch ?? null;

  useEffect(() => {
    if (!latest || latest.status !== "live" || latestEpoch === null) {
      return;
    }
    if (lastEpochRef.current === latestEpoch) {
      return;
    }
    lastEpochRef.current = latestEpoch;
    const digit = Number(latest.digit);
    if (!Number.isInteger(digit)) {
      return;
    }

    if (phaseRef.current === "armed" && !LIVE_ORDERS_ENABLED) {
      void openBulk(digit, latestEpoch);
      return;
    }

    if (phaseRef.current === "open" && openRef.current.length > 0) {
      if (entryEpochRef.current === latestEpoch) {
        return;
      }
      settleBulk(digit);
    }
  }, [latest, latestEpoch]);

  async function openBulk(entryDigit: number, epoch: number) {
    const client = sample.getClient();
    if (!client) {
      setPhase("idle");
      setNotice("Public market client is not ready.");
      return;
    }
    setNotice("Waiting for a public proposal quote…");
    const opened = await openQuotedBulk({
      client,
      symbol: sample.symbol,
      side,
      stake,
      count: Math.min(MAX_BULK, Math.max(1, bulkCount)),
      entryDigit,
      session: sessionRef.current,
    });
    if (!opened) {
      setPhase("idle");
      setNotice("Paper quote failed. No bulk trades opened.");
      return;
    }
    entryEpochRef.current = epoch;
    sessionRef.current = opened.session;
    openRef.current = opened.trades;
    setSession(opened.session);
    setOpenTrades(opened.trades);
    setPhase("open");
    setNotice(
      `${opened.trades.length} paper ${side} contracts are open. They share the next tick as exit.`,
    );
  }

  function settleBulk(exitDigit: number) {
    let nextSession = sessionRef.current;
    const settled: PaperTrade[] = [];
    for (const trade of openRef.current) {
      const result = closeControlledPaperTrade(nextSession, trade, exitDigit);
      nextSession = result.session;
      settled.push(result.trade);
    }
    sessionRef.current = nextSession;
    openRef.current = [];
    setSession(nextSession);
    setOpenTrades([]);
    setPhase("idle");
    const wins = settled.filter((item) => item.status === "WON").length;
    setNotice(
      `Bulk closed on digit ${exitDigit}: ${wins}/${settled.length} paper wins. P/L ${nextSession.profitLoss.toFixed(2)}.`,
    );
  }

  function arm(nextSide: "EVEN" | "ODD") {
    if (sample.connectionState !== "connected") {
      setNotice("Wait for public market data first.");
      return;
    }
    setSide(nextSide);
    setPhase("armed");
    setNotice(`Armed ${nextSide}. Paper bulk opens on the next live tick.`);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Bulk trader
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Paper even / odd bulk
          </h2>
        </div>
        <p className="text-xs text-muted">{connectionLabel(sample.connectionState)}</p>
      </div>
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6">
        All paper contracts open on the selected market after the next tick and
        share one exit tick. Live buy/sell stays off.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-muted">
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
        <div className="rounded-md border border-border bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-[0.12em] text-muted">Current tick</p>
          <p className="mt-1 font-mono text-2xl">
            {sample.latest?.formattedPrice ?? "—"}
          </p>
        </div>
      </div>

      <Card title="Pattern" badge={`${sample.digits.length} ticks`}>
        <DigitMeter digits={sample.digits} mode="even-odd" />
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField label="Stake" value={stake} onChange={setStake} min={0.35} step={0.01} />
        <NumberField
          label="No. of bulk trades"
          value={bulkCount}
          onChange={setBulkCount}
          min={1}
          max={MAX_BULK}
          step={1}
        />
        <div className="rounded-md border border-border px-3 py-2 text-sm text-muted">
          Paper P/L {session.profitLoss.toFixed(2)} · {session.wins}/{session.losses}
        </div>
      </div>

      <p className="text-sm text-muted">{notice}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => arm("EVEN")}
          disabled={phase !== "idle"}
          className="rounded-lg border border-accent/40 bg-accent/15 px-4 py-6 text-lg font-semibold disabled:opacity-50"
        >
          Even
        </button>
        <button
          type="button"
          onClick={() => arm("ODD")}
          disabled={phase !== "idle"}
          className="rounded-lg border border-warning/40 bg-warning/15 px-4 py-6 text-lg font-semibold disabled:opacity-50"
        >
          Odd
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max?: number;
  step: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}

async function openQuotedBulk(params: {
  client: PaperProposalClient;
  symbol: string;
  side: "EVEN" | "ODD";
  stake: number;
  count: number;
  entryDigit: number;
  session: TradingSession;
}): Promise<{ trades: PaperTrade[]; session: TradingSession } | null> {
  try {
    const proposal = await params.client.requestProposal(
      paperProposalRequest({
        amount: params.stake,
        currency: "USD",
        symbol: params.symbol,
        contractType: params.side === "EVEN" ? "DIGITEVEN" : "DIGITODD",
      }),
    );
    const quote = parseProposalQuote(proposal);
    if (!quote) {
      return null;
    }

    const trades: PaperTrade[] = [];
    const session = params.session;
    for (let index = 0; index < params.count; index += 1) {
      const opened = openControlledPaperTrade(
        session,
        {
          strategy: "EVEN_ODD",
          symbol: params.symbol,
          contractType: params.side === "EVEN" ? "DIGITEVEN" : "DIGITODD",
          entryDigit: params.entryDigit,
          confidence: 1,
          quote,
          evenOddSide: params.side,
          targetProfit: 0.1,
        },
        { ...DEFAULT_RISK_CONFIG, stake: params.stake, maxTradesPerSession: 80 },
      );
      if (!opened.allowed || !opened.trade) {
        break;
      }
      trades.push(opened.trade);
    }
    if (trades.length === 0) {
      return null;
    }
    return { trades, session };
  } catch {
    return null;
  }
}
