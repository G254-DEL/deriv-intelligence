import { MarketDataStatus } from "@/components/layout/MarketDataStatus";
import { AccountStatus } from "@/components/layout/AccountStatus";

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
        <MarketDataStatus />
        <AccountStatus />
      </div>
    </header>
  );
}
