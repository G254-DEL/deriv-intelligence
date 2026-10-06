import {
  buildDigitDistribution,
  digitDistributionRows,
  type DigitDistributionRow,
  type DigitRankRole,
} from "@/src/lib/strategy/digit-distribution";

const ROLE_RING: Record<DigitRankRole, string> = {
  highest: "border-emerald-400 text-emerald-300",
  "second-highest": "border-amber-300 text-amber-200",
  lowest: "border-red-400 text-red-300",
  "second-lowest": "border-sky-400 text-sky-300",
  neutral: "border-border text-muted",
};

const ROLE_TEXT: Record<DigitRankRole, string> = {
  highest: "text-emerald-300",
  "second-highest": "text-amber-200",
  lowest: "text-red-300",
  "second-lowest": "text-sky-300",
  neutral: "text-muted",
};

const ROLE_BAR: Record<DigitRankRole, string> = {
  highest: "bg-emerald-400",
  "second-highest": "bg-amber-300",
  lowest: "bg-red-400",
  "second-lowest": "bg-sky-400",
  neutral: "bg-muted/40",
};

const ROLE_DETAIL: Record<DigitRankRole, string> = {
  highest: "Most appearing",
  "second-highest": "2nd highest",
  lowest: "Least appearing",
  "second-lowest": "2nd lowest",
  neutral: "",
};

const SUMMARIES: Array<{
  role: Exclude<DigitRankRole, "neutral">;
  title: string;
}> = [
  { role: "highest", title: "Highest" },
  { role: "second-highest", title: "2nd highest" },
  { role: "lowest", title: "Lowest" },
  { role: "second-lowest", title: "2nd lowest" },
];

export function DigitMeter({
  digits,
  overUnderBarrier = 7,
  mode = "even-odd",
}: {
  digits: number[];
  overUnderBarrier?: number;
  mode?: "even-odd" | "over-under";
}) {
  const distribution = buildDigitDistribution(digits);
  const rows = digitDistributionRows(distribution);
  const maxCount = rows.reduce((max, row) => Math.max(max, row.count), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          Digit distribution
        </p>
        <div className="overflow-x-auto">
          <div className="flex min-w-[36rem] justify-between gap-1">
            {rows.map((row) => (
              <DigitRing key={row.digit} row={row} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-muted">
          Frequency in the current sample. Not a trade signal.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SUMMARIES.map((item) => {
          const row = rows.find((entry) => entry.role === item.role);
          return (
            <div
              key={item.role}
              className="rounded-md border border-border bg-background px-2.5 py-2"
            >
              <p className={`text-[10px] font-medium uppercase tracking-[0.12em] ${ROLE_TEXT[item.role]}`}>
                {item.title}
              </p>
              <p className="mt-1 font-mono text-sm text-foreground">
                {row && distribution.sampleSize > 0
                  ? `${row.digit} · ${row.percent.toFixed(1)}%`
                  : "—"}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <DigitBar key={row.digit} row={row} maxCount={maxCount} />
        ))}
      </div>

      {mode === "even-odd" ? (
        <div className="grid grid-cols-2 gap-2">
          <Split label="Even" percent={distribution.evenPercent} />
          <Split label="Odd" percent={distribution.oddPercent} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Split
            label={`Over ${overUnderBarrier}`}
            percent={percentAbove(rows, overUnderBarrier, distribution.sampleSize)}
          />
          <Split
            label={`Under ${overUnderBarrier}`}
            percent={percentBelow(rows, overUnderBarrier, distribution.sampleSize)}
          />
        </div>
      )}
    </div>
  );
}

function DigitRing({ row }: { row: DigitDistributionRow }) {
  return (
    <div className="flex w-9 flex-col items-center gap-1">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold ${ROLE_RING[row.role]}`}
        aria-label={ringLabel(row)}
      >
        {row.digit}
      </div>
      <span className={`font-mono text-[10px] leading-none ${ROLE_TEXT[row.role]}`}>
        {row.percent.toFixed(1)}%
      </span>
    </div>
  );
}

function DigitBar({
  row,
  maxCount,
}: {
  row: DigitDistributionRow;
  maxCount: number;
}) {
  const width = maxCount === 0 ? 0 : (row.count / maxCount) * 100;
  const detail = ROLE_DETAIL[row.role];

  return (
    <div className="grid grid-cols-[4.5rem_1fr_3.4rem] items-center gap-2 sm:grid-cols-[4.5rem_1fr_3.4rem_7.5rem]">
      <span className={`text-xs ${ROLE_TEXT[row.role]}`}>Digit {row.digit}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full ${ROLE_BAR[row.role]}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`text-right font-mono text-[11px] ${ROLE_TEXT[row.role]}`}>
        {row.percent.toFixed(1)}%
      </span>
      <span className={`hidden text-[10px] uppercase tracking-[0.08em] sm:block ${ROLE_TEXT[row.role]}`}>
        {detail}
      </span>
    </div>
  );
}

function Split({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-center">
      <p className="font-mono text-sm font-semibold text-foreground">
        {percent.toFixed(1)}%
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
    </div>
  );
}

function ringLabel(row: DigitDistributionRow): string {
  const detail = ROLE_DETAIL[row.role];
  const base = `Digit ${row.digit}, ${row.percent.toFixed(1)} percent`;
  return detail ? `${base}, ${detail}` : base;
}

function percentAbove(
  rows: DigitDistributionRow[],
  barrier: number,
  sampleSize: number,
): number {
  if (sampleSize === 0) {
    return 0;
  }
  const count = rows.reduce(
    (sum, row) => (row.digit > barrier ? sum + row.count : sum),
    0,
  );
  return (count / sampleSize) * 100;
}

function percentBelow(
  rows: DigitDistributionRow[],
  barrier: number,
  sampleSize: number,
): number {
  if (sampleSize === 0) {
    return 0;
  }
  const count = rows.reduce(
    (sum, row) => (row.digit < barrier ? sum + row.count : sum),
    0,
  );
  return (count / sampleSize) * 100;
}
