"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  createEmptyDraft,
  STRATEGY_TYPES,
  type StrategyDraft,
  type StrategyType,
} from "@/src/lib/strategy/saved-strategy";
import {
  getSavedStrategiesSnapshot,
  writeSavedStrategies,
} from "@/src/lib/strategy/storage";
import { useMarketDigitSample } from "@/components/market/useMarketDigitSample";
import { writeLoadedBotId } from "@/src/lib/trading/bot-presets";
import { DEFAULT_RISK_CONFIG } from "@/src/lib/trading/risk";
import { useRouter } from "next/navigation";

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none";
const labelClass =
  "mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted";

export function BotBuilderView() {
  const router = useRouter();
  const sample = useMarketDigitSample(100);
  const [draft, setDraft] = useState<StrategyDraft>(() => ({
    ...createEmptyDraft(),
    name: "Quick Under 7",
    strategyType: "Under 7",
    ticksToMonitor: 1,
  }));
  const [notice, setNotice] = useState<string | null>(null);

  const marketOptions = sample.symbols;

  function update<K extends keyof StrategyDraft>(key: K, value: StrategyDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const contractHint = useMemo(() => {
    switch (draft.strategyType) {
      case "Even/Odd":
        return "DIGITEVEN / DIGITODD from the live last digit.";
      case "Over 2":
      case "Over 3":
        return "DIGITOVER on the selected barrier.";
      case "Under 7":
      case "Under 8":
        return "DIGITUNDER on the selected barrier.";
      default:
        return "Master will map the dominant digit to a contract.";
    }
  }, [draft.strategyType]);

  function saveAndLoad() {
    if (!draft.name.trim()) {
      setNotice("Name the bot first.");
      return;
    }
    const market =
      draft.market || sample.symbol || marketOptions[0]?.underlying_symbol || "";
    if (!market) {
      setNotice("Wait for markets to load.");
      return;
    }
    const match = marketOptions.find((item) => item.underlying_symbol === market);
    const saved = {
      ...draft,
      market,
      marketName: match?.underlying_symbol_name ?? market,
      risk: {
        ...DEFAULT_RISK_CONFIG,
        ...draft.risk,
        maxConsecutiveLosses: Math.min(3, Math.max(1, draft.risk.maxConsecutiveLosses)),
      },
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
    };
    writeSavedStrategies([saved, ...getSavedStrategiesSnapshot()]);
    writeLoadedBotId(botIdForType(draft.strategyType));
    setNotice(`Saved “${saved.name}” and loaded it for paper bots.`);
    router.push("/bot-monitor");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
          Bot builder
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
          Quick strategy
        </h2>
      </div>
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6">
        Same idea as a block builder: market, Over/Under or Even/Odd, stake, and
        capped recovery. This writes a paper strategy and loads it on Bot Monitor.
        Live orders stay off. Recovery is capped; it cannot guarantee profit.
      </p>

      <Card title="Trade parameters">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className={labelClass}>Name</span>
            <input
              className={fieldClass}
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Market</span>
            <select
              className={fieldClass}
              value={draft.market || sample.symbol}
              onChange={(event) => {
                const code = event.target.value;
                const match = marketOptions.find(
                  (item) => item.underlying_symbol === code,
                );
                setDraft((current) => ({
                  ...current,
                  market: code,
                  marketName: match?.underlying_symbol_name ?? code,
                }));
                sample.setSymbol(code);
              }}
            >
              {marketOptions.map((item) => (
                <option key={item.underlying_symbol} value={item.underlying_symbol}>
                  {item.underlying_symbol_name ?? item.underlying_symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Contract</span>
            <select
              className={fieldClass}
              value={draft.strategyType}
              onChange={(event) =>
                update("strategyType", event.target.value as StrategyType)
              }
            >
              {STRATEGY_TYPES.filter((item) => item !== "Matches").map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Duration (ticks)</span>
            <input className={fieldClass} type="number" min={1} max={1} value={1} readOnly />
          </label>
          <label className="block">
            <span className={labelClass}>Stake</span>
            <input
              className={fieldClass}
              type="number"
              min={0.35}
              step={0.01}
              value={draft.risk.stake}
              onChange={(event) =>
                update("risk", { ...draft.risk, stake: Number(event.target.value) })
              }
            />
          </label>
          <label className="block">
            <span className={labelClass}>Recovery steps (max 3)</span>
            <input
              className={fieldClass}
              type="number"
              min={1}
              max={3}
              value={draft.risk.maxConsecutiveLosses}
              onChange={(event) =>
                update("risk", {
                  ...draft.risk,
                  maxConsecutiveLosses: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <p className="mt-4 text-sm text-muted">{contractHint}</p>
        {notice ? <p className="mt-3 text-sm text-accent">{notice}</p> : null}
        <button
          type="button"
          onClick={saveAndLoad}
          className="mt-5 rounded-md border border-border bg-surface-raised px-4 py-2 text-sm"
        >
          Save and load on Bot Monitor
        </button>
      </Card>
    </div>
  );
}

function botIdForType(type: StrategyType): string {
  if (type === "Over 2" || type === "Over 3") {
    return "over-hunter";
  }
  if (type === "Under 7" || type === "Under 8") {
    return "under-hunter";
  }
  if (type === "Even/Odd") {
    return "even-odd-hunter";
  }
  return "autoswitcher";
}
