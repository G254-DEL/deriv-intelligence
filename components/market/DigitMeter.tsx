import {
  buildDigitDistribution,
  overPercent,
  underPercent,
} from "@/src/lib/strategy/digit-distribution";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function DigitMeter({
  digits,
  overUnderBarrier = 7,
  mode = "even-odd",
}: {
  digits: number[];
  overUnderBarrier?: number;
  mode?: "even-odd" | "over-under";
}) {
  const stats = buildDigitDistribution(digits);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          Digit distribution
        </p>
        <div className="grid grid-cols-5 gap-3 sm:grid-cols-10">
          {DIGITS.map((digit) => {
            const hot = stats.hottestDigit === digit;
            const cold = stats.coldestDigit === digit && stats.sampleSize > 0;
            return (
              <div key={digit} className="flex flex-col items-center gap-2">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-full border text-lg font-semibold ${
                    hot
                      ? "border-accent text-foreground"
                      : cold
                        ? "border-warning text-foreground"
                        : "border-border text-muted"
                  }`}
                >
                  {digit}
                </div>
                <span className="text-xs font-mono text-muted">
                  {stats.percents[digit].toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-muted">
          {stats.hottestDigit !== null ? (
            <span>Hottest {stats.hottestDigit}</span>
          ) : null}
          {stats.coldestDigit !== null ? (
            <span>Coldest {stats.coldestDigit}</span>
          ) : null}
        </div>
      </div>

      {mode === "even-odd" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Split label="Even" percent={stats.evenPercent} tone="accent" />
          <Split label="Odd" percent={stats.oddPercent} tone="warning" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Split
            label={`Over ${overUnderBarrier}`}
            percent={overPercent(digits, overUnderBarrier)}
            tone="accent"
          />
          <Split
            label={`Under ${overUnderBarrier}`}
            percent={underPercent(digits, overUnderBarrier)}
            tone="warning"
          />
        </div>
      )}
    </div>
  );
}

function Split({
  label,
  percent,
  tone,
}: {
  label: string;
  percent: number;
  tone: "accent" | "warning";
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-6 text-center ${
        tone === "accent"
          ? "border-accent/40 bg-accent/10"
          : "border-warning/40 bg-warning/10"
      }`}
    >
      <p className="text-2xl font-semibold text-foreground">{percent.toFixed(1)}%</p>
      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-muted">{label}</p>
    </div>
  );
}
