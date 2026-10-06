"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DigitMeter } from "@/components/market/DigitMeter";
import { useStrategyLabFeed } from "@/components/research/useStrategyLabFeed";
import { connectionLabel } from "@/src/lib/deriv";
import { compareLabResults, type LabComparison } from "@/src/lib/research/lab-compare";
import { evaluateLabMonitor, type LabEvaluation } from "@/src/lib/research/lab-monitor";
import { promoteForPaper } from "@/src/lib/research/lab-promotion";
import {
  chronologicalHoldout,
  replayLabVariant,
  type ContractPerformance,
} from "@/src/lib/research/lab-replay";
import {
  addExperiment,
  addVariant,
  appendObservation,
  emptyLabState,
  LAB_STORAGE_NOTE,
  loadLabState,
  observationsToTicks,
  saveLabState,
  sessionLabStore,
  type LabExperiment,
  type LabObservation,
  type LabPersistedState,
} from "@/src/lib/research/lab-store";
import { classifyLabResearch } from "@/src/lib/research/lab-validation";
import {
  createLabVariant,
  operationalVariant,
  parameterDifferences,
  type LabVariant,
} from "@/src/lib/research/lab-variant";
import { explainEntry } from "@/src/lib/research/replay";
import { getStrategy, listStrategies } from "@/src/lib/research/registry";
import type { StrategyDefinition } from "@/src/lib/research/strategy-spec";
import { readLivePaperBook, summarizeLivePaper } from "@/src/lib/research/forward";
import { LIVE_ORDERS_ENABLED } from "@/src/lib/trading/live-orders";

type ReplayBundle = {
  development: ContractPerformance;
  holdout: ContractPerformance | null;
};

export function StrategyLabView() {
  const strategies = listStrategies();
  const [strategyId, setStrategyId] = useState(strategies[0]?.strategyId ?? "");
  const [symbol, setSymbol] = useState("R_10");
  const [lab, setLab] = useState<LabPersistedState>(emptyLabState);
  const [draft, setDraft] = useState({
    name: "",
    sampleWindow: "20",
    minimumSampleSize: "10",
    minimumEdge: "0.08",
    minimumConfidence: "0",
    cooldownTicks: "0",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [replay, setReplay] = useState<ReplayBundle | null>(null);
  const [replayVariantId, setReplayVariantId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<LabComparison | null>(null);
  const [traceEpoch, setTraceEpoch] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const definition = getStrategy(strategyId) ?? strategies[0];

  useEffect(() => {
    setLab(loadLabState(sessionLabStore()));
  }, []);

  const updateLab = useCallback((recipe: (current: LabPersistedState) => LabPersistedState) => {
    setLab((current) => saveLabState(sessionLabStore(), recipe(current)));
  }, []);

  const recordObservation = useCallback(
    (observation: LabObservation) => {
      setLab((current) => saveLabState(sessionLabStore(), appendObservation(current, observation)));
    },
    [],
  );
  const feed = useStrategyLabFeed(symbol, recordObservation);
  const marketSymbols = uniqueSymbols([
    symbol,
    ...feed.symbols.map((item) => item.underlying_symbol),
    ...lab.observations.map((item) => item.symbol),
  ]);

  const variants = useMemo(() => {
    if (!definition) {
      return [];
    }
    const current = operationalVariant(definition);
    const custom = lab.variants.filter((variant) => variant.strategyId === definition.strategyId);
    return [current, ...custom];
  }, [definition, lab.variants]);

  const activeVariant =
    variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null;

  const marketTicks = lab.observations.filter((item) => item.symbol === symbol);
  const digits = marketTicks.map((item) => item.lastDigit);
  const live = definition && activeVariant
    ? evaluateLabMonitor({
        digits,
        definition,
        parameters: activeVariant.parameters,
        enabled: activeVariant.enabled,
      })
    : null;

  const replayMatches = replay !== null && replayVariantId === activeVariant?.id;
  const validation = classifyLabResearch({
    ran: replayMatches,
    development: replayMatches ? replay.development : null,
    holdout: replayMatches ? replay.holdout : null,
    capturedObservations: marketTicks.length,
  });

  function runReplay(variant: LabVariant, sourceDefinition: StrategyDefinition) {
    const ticks = observationsToTicks(marketTicks);
    if (ticks.length === 0) {
      setReplay(null);
      setNotice("NO TEST DATA AVAILABLE");
      return;
    }
    const split = chronologicalHoldout(ticks);
    const development = replayLabVariant({
      definition: sourceDefinition,
      variant,
      ticks: split?.development ?? ticks,
    });
    const holdoutEpochs = new Set(split?.holdout.map((item) => `${item.symbol}:${item.epoch}`) ?? []);
    const holdout = split
      ? replayLabVariant({
          definition: sourceDefinition,
          variant,
          ticks,
          scoreFromEpoch: split.holdout[0]?.epoch,
          scoreTick: (tick) => holdoutEpochs.has(`${tick.symbol}:${tick.epoch}`),
        })
      : null;
    const bundle = { development, holdout };
    setReplay(bundle);
    setReplayVariantId(variant.id);
    const status = classifyLabResearch({
      ran: true,
      development,
      holdout,
      capturedObservations: ticks.length,
    });
    const experiment: LabExperiment = {
      id: `${variant.id}:${Date.now()}`,
      strategyId: variant.strategyId,
      version: variant.version,
      market: symbol,
      parameters: variant.parameters,
      fromEpoch: ticks[0]?.epoch ?? null,
      toEpoch: ticks[ticks.length - 1]?.epoch ?? null,
      sampleSize: ticks.length,
      performance: {
        ...development,
        tradesTrace: development.tradesTrace.slice(-30),
      },
      validationStatus: status.status,
      timestamp: Date.now(),
    };
    updateLab((current) => addExperiment(current, experiment));
    setNotice(
      ticks.length < 200
        ? `${ticks.length} OBSERVATIONS. Not enough for paper validation.`
        : `${ticks.length} OBSERVATIONS`,
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
            Research
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            Strategy Lab
          </h2>
        </div>
        <p className="text-xs text-muted">
          {connectionLabel(feed.connectionState)} · Live orders {LIVE_ORDERS_ENABLED ? "on" : "off"}
        </p>
      </header>
      <p className="text-xs leading-5 text-muted">
        Observation, signal, and contract outcome stay separate from monetary P/L. This page does
        not place orders. {LAB_STORAGE_NOTE}
      </p>
      <LivePaperEvidence />

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Strategy">
          <select
            value={definition?.strategyId ?? ""}
            onChange={(event) => {
              setStrategyId(event.target.value);
              setSelectedVariantId(null);
              setReplay(null);
              setComparison(null);
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {strategies.map((item) => (
              <option key={item.strategyId} value={item.strategyId}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Market">
          <select
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value);
              setReplay(null);
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {(marketSymbols.length > 0 ? marketSymbols : [symbol]).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Variant">
          <select
            value={activeVariant?.id ?? ""}
            onChange={(event) => setSelectedVariantId(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {definition && activeVariant && live ? (
        <>
          <DefinitionPanel definition={definition} variant={activeVariant} />
          <LivePanel
            symbol={symbol}
            latest={feed.latest}
            observations={marketTicks.length}
            live={live}
          />
          <section className="rounded-lg border border-border bg-surface p-3">
            <h3 className="text-sm font-semibold text-foreground">Digit distribution</h3>
            <div className="mt-2">
              <DigitMeter
                digits={digits.slice(-activeVariant.parameters.sampleWindow)}
                mode={definition.barrier === null ? "even-odd" : "over-under"}
                overUnderBarrier={definition.barrier ?? 7}
              />
            </div>
          </section>
          <ExperimentPanel
            draft={draft}
            setDraft={setDraft}
            formError={formError}
            onCreate={() => {
              if (!definition) {
                return;
              }
              const created = createLabVariant({
                definition,
                name: draft.name,
                now: Date.now(),
                version: lab.variants.filter((item) => item.strategyId === definition.strategyId).length + 1,
                overrides: {
                  sampleWindow: Number(draft.sampleWindow),
                  minimumSampleSize: Number(draft.minimumSampleSize),
                  minimumEdge: Number(draft.minimumEdge),
                  minimumConfidence: Number(draft.minimumConfidence),
                  cooldownTicks: Number(draft.cooldownTicks),
                },
              });
              if (!created.ok) {
                setFormError(created.errors.join(" "));
                return;
              }
              setFormError(null);
              updateLab((current) => addVariant(current, created.variant));
              setSelectedVariantId(created.variant.id);
            }}
            onReplay={() => runReplay(activeVariant, definition)}
            onCompare={() => {
              const chosen = variants.filter((variant) => compareIds.includes(variant.id));
              const ticks = observationsToTicks(marketTicks);
              if (!definition || chosen.length < 2 || ticks.length === 0) {
                setNotice(ticks.length === 0 ? "NO TEST DATA AVAILABLE" : "Select at least two variants.");
                return;
              }
              setComparison(
                compareLabResults(
                  chosen.map((variant) => ({
                    name: variant.name,
                    performance: replayLabVariant({ definition, variant, ticks }),
                  })),
                ),
              );
            }}
            variants={variants}
            compareIds={compareIds}
            toggleCompare={(id) => {
              setCompareIds((current) =>
                current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-3),
              );
            }}
          />
          <ResultsPanel
            observations={marketTicks.length}
            replay={replayMatches ? replay : null}
            comparison={comparison}
            notice={replayMatches ? notice : null}
            traceEpoch={traceEpoch}
            onTrace={setTraceEpoch}
          />
          <ValidationPanel
            status={validation.status}
            reasons={validation.reasons}
            replay={replay}
            differences={parameterDifferences(
              definition.parameters,
              activeVariant.parameters,
            )}
            canPromote={
              replayMatches &&
              validation.status === "VALIDATED_FOR_PAPER" &&
              !activeVariant.id.endsWith(":current")
            }
            onPromote={() => {
              if (!definition) {
                return;
              }
              const promotedVariant = { ...activeVariant, researchStatus: validation.status };
              const result = promoteForPaper({
                state: lab,
                memory: sessionLabStore(),
                variant: promotedVariant,
                operational: definition.parameters,
                confirmed: true,
              });
              setNotice(result.ok ? `Paper config stored. ${result.differences.join("; ") || "No parameter changes."}` : result.reason);
              if (result.ok) {
                setLab(loadLabState(sessionLabStore()));
              }
            }}
          />
          <HistoryPanel experiments={lab.experiments.filter((item) => item.strategyId === definition.strategyId)} />
        </>
      ) : null}
    </div>
  );
}

function DefinitionPanel(props: { definition: StrategyDefinition; variant: LabVariant }) {
  const parameters = props.variant.parameters;
  return (
    <section className="rounded-lg border border-border bg-surface p-3 text-xs leading-5">
      <h3 className="text-sm font-semibold text-foreground">Strategy definition</h3>
      <p className="mt-1 text-muted">{props.definition.hypothesis}</p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        <Line label="What it watches" value={props.definition.baselineExplanation} />
        <Line label="Contract" value={props.definition.contractType} />
        <Line label="Barrier" value={props.definition.barrier === null ? "Parity side" : String(props.definition.barrier)} />
        <Line label="Fair probability" value={percent(props.definition.baselineProbability)} />
        <Line label="Window" value={String(parameters.sampleWindow)} />
        <Line label="Minimum sample" value={String(parameters.minimumSampleSize)} />
        <Line label="Minimum edge" value={String(parameters.minimumEdge)} />
        <Line label="Confidence floor" value={String(parameters.minimumConfidence)} />
        <Line label="Cooldown ticks" value={String(parameters.cooldownTicks)} />
        <Line label="Version" value={`${props.variant.version}`} />
      </div>
      <p className="mt-2 text-muted">Entry requires every condition below. A high digit frequency alone is not a trade.</p>
      <ul className="mt-1 list-disc pl-4 text-muted">
        {props.definition.entryRules.slice(0, 6).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </section>
  );
}

function LivePanel(props: {
  symbol: string;
  latest: { formattedPrice: string; digit: string } | null;
  observations: number;
  live: LabEvaluation;
}) {
  const ranking = props.live.distribution.ranking;
  return (
    <section className="rounded-lg border border-border bg-surface p-3 text-xs">
      <h3 className="text-sm font-semibold text-foreground">Live evaluation</h3>
      <p className="mt-1 text-muted">
        {props.observations === 0 ? "NO TEST DATA AVAILABLE" : `${props.observations} OBSERVATIONS`}
      </p>
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        <Line label="Market" value={props.symbol} />
        <Line label="Latest tick" value={props.latest?.formattedPrice ?? "—"} />
        <Line label="Latest digit" value={props.latest?.digit ?? "—"} />
        <Line label="Sample" value={String(props.live.sampleSize)} />
        <Line label="State" value={props.live.state} />
        <Line label="Observed" value={percent(props.live.observedProbability)} />
        <Line label="Baseline" value={percent(props.live.baselineProbability)} />
        <Line label="Edge" value={numberText(props.live.edge)} />
        <Line label="Highest" value={digitText(ranking.highest)} />
        <Line label="2nd highest" value={digitText(ranking.secondHighest)} />
        <Line label="Lowest" value={digitText(ranking.lowest)} />
        <Line label="2nd lowest" value={digitText(ranking.secondLowest)} />
      </div>
      <p className="mt-2 text-foreground">{props.live.reason}</p>
      <ul className="mt-2 space-y-1">
        {props.live.checks.map((check) => (
          <li key={check.label} className="flex justify-between gap-3 text-muted">
            <span>{check.passed ? "Pass" : "Fail"} · {check.label}</span>
            <span>{check.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExperimentPanel(props: {
  draft: {
    name: string;
    sampleWindow: string;
    minimumSampleSize: string;
    minimumEdge: string;
    minimumConfidence: string;
    cooldownTicks: string;
  };
  setDraft: (value: {
    name: string;
    sampleWindow: string;
    minimumSampleSize: string;
    minimumEdge: string;
    minimumConfidence: string;
    cooldownTicks: string;
  }) => void;
  formError: string | null;
  onCreate: () => void;
  onReplay: () => void;
  onCompare: () => void;
  variants: LabVariant[];
  compareIds: string[];
  toggleCompare: (id: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3 text-xs">
      <h3 className="text-sm font-semibold text-foreground">Experiment controls</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <input
          value={props.draft.name}
          onChange={(event) => props.setDraft({ ...props.draft, name: event.target.value })}
          placeholder="Under 7 - Variant A"
          className="rounded-md border border-border bg-background px-2 py-1.5"
        />
        <NumberInput label="Window" value={props.draft.sampleWindow} onChange={(value) => props.setDraft({ ...props.draft, sampleWindow: value })} />
        <NumberInput label="Min sample" value={props.draft.minimumSampleSize} onChange={(value) => props.setDraft({ ...props.draft, minimumSampleSize: value })} />
        <NumberInput label="Min edge" value={props.draft.minimumEdge} onChange={(value) => props.setDraft({ ...props.draft, minimumEdge: value })} />
        <NumberInput label="Confidence" value={props.draft.minimumConfidence} onChange={(value) => props.setDraft({ ...props.draft, minimumConfidence: value })} />
        <NumberInput label="Cooldown ticks" value={props.draft.cooldownTicks} onChange={(value) => props.setDraft({ ...props.draft, cooldownTicks: value })} />
      </div>
      {props.formError ? <p className="mt-2 text-warning">{props.formError}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="rounded-md border border-border px-2 py-1" onClick={props.onCreate}>
          Create variant
        </button>
        <button type="button" className="rounded-md border border-border px-2 py-1" onClick={props.onReplay}>
          Run replay
        </button>
        <button type="button" className="rounded-md border border-border px-2 py-1" onClick={props.onCompare}>
          Compare
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-muted">
        {props.variants.map((variant) => (
          <label key={variant.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={props.compareIds.includes(variant.id)}
              onChange={() => props.toggleCompare(variant.id)}
            />
            {variant.name}
          </label>
        ))}
      </div>
    </section>
  );
}

function ResultsPanel(props: {
  observations: number;
  replay: ReplayBundle | null;
  comparison: LabComparison | null;
  notice: string | null;
  traceEpoch: number | null;
  onTrace: (epoch: number) => void;
}) {
  const performance = props.replay?.development ?? null;
  const traced = performance?.tradesTrace.find((event) => event.signalEpoch === props.traceEpoch) ?? null;
  return (
    <section className="rounded-lg border border-border bg-surface p-3 text-xs">
      <h3 className="text-sm font-semibold text-foreground">Results</h3>
      {props.notice ? <p className="mt-1 text-muted">{props.notice}</p> : null}
      {!performance ? (
        <p className="mt-2 text-muted">
          {props.observations === 0
            ? "NO TEST DATA AVAILABLE"
            : `${props.observations} OBSERVATIONS captured. Replay has not been run.`}
        </p>
      ) : (
        <>
          <MetricGrid performance={performance} title="Development" />
          {props.replay?.holdout ? <MetricGrid performance={props.replay.holdout} title="Out of sample" /> : null}
          <p className="mt-2 text-muted">{performance.monetaryNote}</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1">Time</th>
                  <th>Market</th>
                  <th>State</th>
                  <th>Outcome</th>
                  <th>P/L</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {performance.tradesTrace.slice(-12).map((event) => (
                  <tr key={`${event.symbol}-${event.signalEpoch}`} className="border-t border-border">
                    <td className="py-1">{event.signalEpoch}</td>
                    <td>{event.symbol}</td>
                    <td>{event.entryPhase}</td>
                    <td>{event.won === null ? "—" : event.won ? "WIN" : "LOSS"}</td>
                    <td>{event.profitLoss === null ? "Not determined" : event.profitLoss.toFixed(2)}</td>
                    <td>
                      <button
                        type="button"
                        className="rounded border border-border px-1.5 py-0.5"
                        onClick={() => props.onTrace(event.signalEpoch)}
                      >
                        Trace
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {traced ? <p className="mt-2 leading-5 text-muted">{explainEntry(traced)}</p> : null}
          {performance.bySymbol.length > 0 ? (
            <div className="mt-3">
              <h4 className="font-medium text-foreground">By market</h4>
              {performance.bySymbol.map((row) => (
                <p key={row.symbol} className="text-muted">
                  {row.symbol}: {row.trades} trades, {row.wins} wins, {row.losses} losses, win rate {percent(row.winRate)}, edge {numberText(row.averageEdge)}
                </p>
              ))}
            </div>
          ) : null}
        </>
      )}
      {props.comparison ? (
        <div className="mt-3 overflow-x-auto">
          <h4 className="font-medium text-foreground">Comparison</h4>
          <p className="text-muted">{props.comparison.note}</p>
          <table className="mt-1 w-full text-left">
            <thead className="text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1">Metric</th>
                {props.comparison.names.map((name) => (
                  <th key={name}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.comparison.metrics.map((metric) => (
                <tr key={metric.label} className="border-t border-border">
                  <td className="py-1">{metric.label}</td>
                  {metric.values.map((value, index) => (
                    <td key={`${metric.label}-${props.comparison?.names[index]}`}>
                      {value} {metric.flags[index] === "unchanged" ? "" : metric.flags[index]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function ValidationPanel(props: {
  status: string;
  reasons: string[];
  replay: ReplayBundle | null;
  differences: string[];
  canPromote: boolean;
  onPromote: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3 text-xs">
      <h3 className="text-sm font-semibold text-foreground">Validation</h3>
      <p className="mt-1 text-foreground">{props.status}</p>
      {props.reasons.map((reason) => (
        <p key={reason} className="mt-1 text-muted">{reason}</p>
      ))}
      <p className="mt-2 text-muted">
        {props.differences.length === 0
          ? "This variant matches the operational paper parameters."
          : `Parameter differences: ${props.differences.join("; ")}`}
      </p>
      <button
        type="button"
        className="mt-2 rounded-md border border-border px-2 py-1 disabled:opacity-40"
        disabled={!props.canPromote}
        onClick={props.onPromote}
      >
        Promote for paper
      </button>
      <p className="mt-1 text-muted">Promotion stores a paper configuration only. It does not arm a bot or send an order.</p>
    </section>
  );
}

function HistoryPanel(props: { experiments: LabExperiment[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3 text-xs">
      <h3 className="text-sm font-semibold text-foreground">Experiment history</h3>
      {props.experiments.length === 0 ? (
        <p className="mt-1 text-muted">No saved experiments in this session.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-muted">
          {props.experiments.slice().reverse().map((experiment) => (
            <li key={experiment.id}>
              {experiment.market} · v{experiment.version} · {experiment.sampleSize} observations · {experiment.validationStatus}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MetricGrid(props: { title: string; performance: ContractPerformance }) {
  return (
    <div className="mt-2">
      <h4 className="font-medium text-foreground">{props.title}</h4>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <Line label="Trades" value={String(props.performance.trades)} />
        <Line label="Wins" value={String(props.performance.wins)} />
        <Line label="Losses" value={String(props.performance.losses)} />
        <Line label="Win rate" value={percent(props.performance.winRate)} />
        <Line label="Avg edge" value={numberText(props.performance.averageEdge)} />
        <Line label="Max loss streak" value={String(props.performance.maximumConsecutiveLosses)} />
        <Line label="P/L" value={props.performance.monetaryStatus === "AVAILABLE" ? numberText(props.performance.netProfitLoss) : "Not determined"} />
        <Line label="Skipped" value={String(props.performance.skipped)} />
      </div>
    </div>
  );
}

function LivePaperEvidence() {
  const [summary, setSummary] = useState(() => summarizeLivePaper(readLivePaperBook()));
  useEffect(() => {
    const refresh = () => setSummary(summarizeLivePaper(readLivePaperBook()));
    refresh();
    const handle = window.setInterval(refresh, 2000);
    return () => window.clearInterval(handle);
  }, []);
  const profit =
    summary.profitLoss === null ? "unavailable" : summary.profitLoss.toFixed(2);
  return (
    <p className="text-xs leading-5 text-muted">
      Completed Bot Monitor paper trades, read only: {summary.trades} settled, {summary.wins} wins,{" "}
      {summary.losses} losses, simulated P/L {profit}. Strategy Lab does not start or route those trades.
    </p>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block uppercase tracking-[0.12em] text-muted">{props.label}</span>
      {props.children}
    </label>
  );
}

function NumberInput(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-muted">{props.label}</span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5"
      />
    </label>
  );
}

function Line(props: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-3 text-muted">
      <span>{props.label}</span>
      <span className="text-right text-foreground">{props.value}</span>
    </p>
  );
}

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function numberText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(3);
}

function digitText(value: number | null): string {
  return value === null ? "—" : String(value);
}

function uniqueSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.filter(Boolean))];
}
