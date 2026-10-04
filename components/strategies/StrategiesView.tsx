"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Card } from "@/components/ui/Card";
import { useAfterHydration } from "@/lib/use-after-hydration";
import {
  retainPublicMarketData,
  type DerivActiveSymbol,
} from "@/src/lib/deriv";
import {
  createEmptyDraft,
  draftFromStrategy,
  STRATEGY_TYPES,
  type SavedStrategy,
  type StrategyDraft,
} from "@/src/lib/strategy/saved-strategy";
import {
  getSavedStrategiesServerSnapshot,
  getSavedStrategiesSnapshot,
  subscribeSavedStrategies,
  writeSavedStrategies,
} from "@/src/lib/strategy/storage";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none";
const labelClass =
  "mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted";

type Notice = {
  type: "success" | "error";
  text: string;
};

export function StrategiesView() {
  const hydrated = useAfterHydration();
  const strategies = useSyncExternalStore(
    subscribeSavedStrategies,
    getSavedStrategiesSnapshot,
    getSavedStrategiesServerSnapshot,
  );
  const [markets, setMarkets] = useState<DerivActiveSymbol[]>([]);
  const [draft, setDraft] = useState<StrategyDraft>(createEmptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const session = retainPublicMarketData({
      onActiveSymbols: (nextSymbols) => {
        setMarkets(nextSymbols);
      },
    });

    return () => session.release();
  }, []);

  const editingName = useMemo(() => {
    if (!editingId) {
      return null;
    }
    return strategies.find((item) => item.id === editingId)?.name ?? null;
  }, [editingId, strategies]);

  function showNotice(type: Notice["type"], text: string) {
    setNotice({ type, text });
  }

  function openCreate() {
    setEditingId(null);
    setDraft(createEmptyDraft());
    setFormOpen(true);
    setPendingDeleteId(null);
  }

  function openEdit(strategy: SavedStrategy) {
    setEditingId(strategy.id);
    setDraft(draftFromStrategy(strategy));
    setFormOpen(true);
    setPendingDeleteId(null);
  }

  function cancelForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(createEmptyDraft());
  }

  function saveDraft() {
    const validated = validateDraft(draft);
    if (!validated.ok) {
      showNotice("error", validated.message);
      return;
    }

    const now = Date.now();

    if (editingId) {
      writeSavedStrategies(
        strategies.map((item) =>
          item.id === editingId
            ? { ...validated.draft, id: item.id, updatedAt: now }
            : item,
        ),
      );
      showNotice("success", `Updated “${validated.draft.name}”.`);
    } else {
      writeSavedStrategies([
        {
          ...validated.draft,
          id: createStrategyId(),
          updatedAt: now,
        },
        ...strategies,
      ]);
      showNotice("success", `Created “${validated.draft.name}”.`);
    }

    cancelForm();
  }

  function toggleActive(id: string) {
    const strategy = strategies.find((item) => item.id === id);
    writeSavedStrategies(
      strategies.map((item) =>
        item.id === id
          ? { ...item, active: !item.active, updatedAt: Date.now() }
          : item,
      ),
    );
    if (strategy) {
      showNotice(
        "success",
        `${strategy.name} is now ${strategy.active ? "inactive" : "active"}.`,
      );
    }
  }

  function confirmDelete(id: string) {
    const strategy = strategies.find((item) => item.id === id);
    writeSavedStrategies(strategies.filter((item) => item.id !== id));
    setPendingDeleteId(null);
    if (editingId === id) {
      cancelForm();
    }
    showNotice(
      "success",
      strategy ? `Deleted “${strategy.name}”.` : "Strategy deleted.",
    );
  }

  function updateDraft<K extends keyof StrategyDraft>(
    key: K,
    value: StrategyDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function selectMarket(symbol: string) {
    const match = markets.find((item) => item.underlying_symbol === symbol);
    setDraft((current) => ({
      ...current,
      market: symbol,
      marketName: match?.underlying_symbol_name ?? symbol,
    }));
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
            Configuration
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Strategies
          </h2>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
        >
          New strategy
        </button>
      </div>

      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground">
        Saved strategies pin a home synthetic market and a contract type
        (Under 7, Over 2, Over 3, Under 8, Even/Odd). The Master bot on Bot
        Monitor can reassign markets from live digit samples. They configure
        paper analysis only and never place real-money trades.
      </p>

      {notice ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.type === "error"
              ? "border-border text-warning"
              : "border-border text-accent"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {formOpen ? (
        <Card
          title={editingId ? `Edit strategy${editingName ? `: ${editingName}` : ""}` : "New strategy"}
          badge={editingId ? "Edit" : "Create"}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft();
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Strategy name</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                  className={fieldClass}
                  placeholder="Volatility Under 7 map"
                />
              </label>
              <label className="block">
                <span className={labelClass}>Home market</span>
                <select
                  value={draft.market}
                  onChange={(event) => selectMarket(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">
                    {markets.length === 0
                      ? "Loading markets…"
                      : "Select a market"}
                  </option>
                  {draft.market &&
                  !markets.some(
                    (item) => item.underlying_symbol === draft.market,
                  ) ? (
                    <option value={draft.market}>
                      {draft.marketName || draft.market}
                    </option>
                  ) : null}
                  {markets.map((item) => (
                    <option
                      key={item.underlying_symbol}
                      value={item.underlying_symbol}
                    >
                      {item.underlying_symbol_name ?? item.underlying_symbol}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Strategy type</span>
                <select
                  value={draft.strategyType}
                  onChange={(event) =>
                    updateDraft(
                      "strategyType",
                      event.target.value as StrategyDraft["strategyType"],
                    )
                  }
                  className={fieldClass}
                >
                  {STRATEGY_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Ticks to monitor</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={draft.ticksToMonitor}
                  onChange={(event) =>
                    updateDraft("ticksToMonitor", Number(event.target.value))
                  }
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Entry digit</span>
                <select
                  value={draft.entryDigit}
                  onChange={(event) =>
                    updateDraft("entryDigit", Number(event.target.value))
                  }
                  className={`${fieldClass} font-mono`}
                >
                  {DIGITS.map((digit) => (
                    <option key={digit} value={digit}>
                      {digit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Confirmation digits</span>
                <input
                  value={draft.confirmationDigits.join(", ")}
                  onChange={(event) =>
                    updateDraft(
                      "confirmationDigits",
                      parseConfirmationInput(event.target.value),
                    )
                  }
                  className={`${fieldClass} font-mono`}
                  placeholder="5, 6"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <label className="block">
                <span className={labelClass}>Paper stake</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.risk.stake}
                  onChange={(event) =>
                    updateDraft("risk", {
                      ...draft.risk,
                      stake: Number(event.target.value),
                    })
                  }
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Max session loss</span>
                <input
                  type="number"
                  min={0}
                  value={draft.risk.maxSessionLoss}
                  onChange={(event) =>
                    updateDraft("risk", {
                      ...draft.risk,
                      maxSessionLoss: Number(event.target.value),
                    })
                  }
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Max consecutive losses</span>
                <input
                  type="number"
                  min={1}
                  value={draft.risk.maxConsecutiveLosses}
                  onChange={(event) =>
                    updateDraft("risk", {
                      ...draft.risk,
                      maxConsecutiveLosses: Number(event.target.value),
                    })
                  }
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Max trades / session</span>
                <input
                  type="number"
                  min={1}
                  value={draft.risk.maxTradesPerSession}
                  onChange={(event) =>
                    updateDraft("risk", {
                      ...draft.risk,
                      maxTradesPerSession: Number(event.target.value),
                    })
                  }
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Loss cooldown (ms)</span>
                <input
                  type="number"
                  min={0}
                  value={draft.risk.cooldownAfterLossMs}
                  onChange={(event) =>
                    updateDraft("risk", {
                      ...draft.risk,
                      cooldownAfterLossMs: Number(event.target.value),
                    })
                  }
                  className={fieldClass}
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => updateDraft("active", event.target.checked)}
              />
              Active
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
              >
                {editingId ? "Save changes" : "Create strategy"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card
        title="Saved strategies"
        badge={hydrated ? `${strategies.length}` : "Loading"}
      >
        {!hydrated ? (
          <p className="text-sm text-muted">Loading saved strategies…</p>
        ) : strategies.length === 0 ? (
          <p className="text-sm text-muted">
            No strategies yet. Create one to store entry conditions and paper
            risk limits in this browser.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Market</th>
                  <th className="pb-3 pr-4 font-medium">Entry conditions</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy) => (
                  <tr
                    key={strategy.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="py-3 pr-4">
                      <div className="font-medium text-foreground">
                        {strategy.name}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {strategy.strategyType} · {strategy.ticksToMonitor} ticks
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="text-foreground">
                        {strategy.marketName || strategy.market}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted">
                        {strategy.market}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-muted">
                      {formatEntryConditions(strategy)}
                    </td>
                    <td className="py-3 pr-4 text-foreground">
                      {strategy.active ? "Active" : "Inactive"}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(strategy)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(strategy.id)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground"
                        >
                          {strategy.active ? "Disable" : "Enable"}
                        </button>
                        {pendingDeleteId === strategy.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => confirmDelete(strategy.id)}
                              className="rounded-md border border-border px-2.5 py-1 text-xs text-warning"
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(null)}
                              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(strategy.id)}
                            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function formatEntryConditions(strategy: SavedStrategy): string {
  const confirmation =
    strategy.confirmationDigits.length > 0
      ? ` → ${strategy.confirmationDigits.join(" → ")}`
      : "";
  return `${strategy.entryDigit}${confirmation}`;
}

function parseConfirmationInput(value: string): number[] {
  if (!value.trim()) {
    return [];
  }

  return value
    .split(/[,\s]+/)
    .map((part) => Number(part))
    .filter((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
}

function validateDraft(
  draft: StrategyDraft,
): { ok: true; draft: StrategyDraft } | { ok: false; message: string } {
  const name = draft.name.trim();
  if (!name) {
    return { ok: false, message: "Enter a strategy name." };
  }

  const market = draft.market.trim();
  if (!market) {
    return { ok: false, message: "Select a market." };
  }

  if (!Number.isInteger(draft.entryDigit) || draft.entryDigit < 0 || draft.entryDigit > 9) {
    return { ok: false, message: "Entry digit must be between 0 and 9." };
  }

  if (!Number.isInteger(draft.ticksToMonitor) || draft.ticksToMonitor < 1) {
    return { ok: false, message: "Ticks to monitor must be at least 1." };
  }

  if (!Number.isFinite(draft.risk.stake) || draft.risk.stake < 0) {
    return { ok: false, message: "Paper stake must be zero or greater." };
  }

  return {
    ok: true,
    draft: {
      ...draft,
      name,
      market,
      marketName: draft.marketName.trim() || market,
      confirmationDigits: draft.confirmationDigits.filter(
        (digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9,
      ),
    },
  };
}

function createStrategyId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `strategy-${Date.now()}`;
}
