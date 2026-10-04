export function BotStatusBadge({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "live" | "paper" | "armed" | "idle";
}) {
  const color =
    tone === "live"
      ? "bg-accent"
      : tone === "paper"
        ? "bg-warning"
        : tone === "armed"
          ? "bg-cyan-300"
          : tone === "idle"
            ? "bg-muted"
            : "bg-muted";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-black/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
