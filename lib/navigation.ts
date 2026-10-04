export type NavItem = {
  href: string;
  label: string;
  ready: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", ready: true },
  { href: "/scanner", label: "Market Scanner", ready: true },
  { href: "/analysis", label: "Analysis", ready: true },
  { href: "/entry-maps", label: "Entry Maps", ready: true },
  { href: "/strategies", label: "Strategies", ready: true },
  { href: "/bot-builder", label: "Bot Builder", ready: true },
  { href: "/bulk-trader", label: "Bulk Trader", ready: true },
  { href: "/bot-monitor", label: "Free Bots", ready: true },
  { href: "/backtesting", label: "Backtesting", ready: false },
  { href: "/paper-trading", label: "Paper Trading", ready: false },
  { href: "/trading", label: "Trading", ready: false },
  { href: "/trade-history", label: "Trade History", ready: false },
  { href: "/settings", label: "Settings", ready: false },
];

