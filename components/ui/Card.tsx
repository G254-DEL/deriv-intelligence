type CardProps = {
  title: string;
  badge?: string;
  children: React.ReactNode;
  className?: string;
};

export function Card({ title, badge, children, className = "" }: CardProps) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {badge ? (
          <span className="rounded border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
