/**
 * Static preview content only.
 * Nothing here is a live market feed, a trade recommendation, or a signal.
 */
export const DEMO_LABEL = "Demo Data";
export const UI_PREVIEW_LABEL = "UI Preview";

export const summaryCards = [
  {
    title: "Active Markets",
    value: "3",
    detail: "Sample markets listed for layout only",
  },
  {
    title: "Setups Detected",
    value: "0",
    detail: "No live scanner is connected",
  },
  {
    title: "Entry Signals",
    value: "None",
    detail: "Not a live signal feed",
  },
  {
    title: "Bot Status",
    value: "Idle",
    detail: "Bots are not running in this milestone",
  },
] as const;

export const liveOpportunities = [
  {
    market: "Volatility 10 Index",
    strategy: "Under 7",
    currentDigit: "—",
    entryState: "Waiting",
    lastUpdated: "No live feed",
  },
  {
    market: "Volatility 25 Index",
    strategy: "Over 2",
    currentDigit: "—",
    entryState: "Idle",
    lastUpdated: "No live feed",
  },
  {
    market: "Volatility 75 Index",
    strategy: "Matches",
    currentDigit: "—",
    entryState: "Not configured",
    lastUpdated: "No live feed",
  },
] as const;

export const entryMapPreview = {
  strategy: "Under 7",
  triggerDigit: "4",
  confirmation: "5 → 6",
  currentState: "Demo / Waiting",
} as const;

export const botStatus = [
  { label: "Paper Trading", value: "OFF" },
  { label: "Automatic Trading", value: "OFF" },
  { label: "Risk Controls", value: "Not Configured" },
] as const;
