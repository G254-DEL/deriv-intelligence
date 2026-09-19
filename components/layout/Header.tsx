type HeaderProps = {
  onMenuClick: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md border border-border px-2.5 py-1.5 text-sm text-muted lg:hidden"
          aria-label="Open navigation"
        >
          Menu
        </button>
        <h1 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
          Deriv Intelligence
        </h1>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
          <span className="text-muted">Connection</span>
          <span className="font-medium text-foreground">Demo UI</span>
        </div>

        <div className="hidden items-center gap-2 border-l border-border pl-4 sm:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-raised text-xs font-medium text-muted">
            DI
          </div>
          <div className="leading-tight">
            <p className="text-xs font-medium text-foreground">Account</p>
            <p className="text-[11px] text-muted">Placeholder · not signed in</p>
          </div>
        </div>
      </div>
    </header>
  );
}
