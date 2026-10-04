export type FreeBotPreset = {
  id: string;
  name: string;
  family: "OVER" | "UNDER" | "EVEN/ODD" | "MASTER";
  summary: string;
  strategies: Array<"UNDER_7" | "UNDER_8" | "OVER_2" | "OVER_3" | "EVEN_ODD">;
  master: boolean;
};

export const FREE_BOT_PRESETS: FreeBotPreset[] = [
  {
    id: "autoswitcher",
    name: "Autoswitcher",
    family: "MASTER",
    summary: "Master ranks volatilities and hands each specialist a market.",
    strategies: ["UNDER_7", "OVER_2", "OVER_3", "UNDER_8", "EVEN_ODD"],
    master: true,
  },
  {
    id: "under-hunter",
    name: "Under Hunter",
    family: "UNDER",
    summary: "Trades Under 7 and Under 8 when high digits dominate.",
    strategies: ["UNDER_7", "UNDER_8"],
    master: false,
  },
  {
    id: "over-hunter",
    name: "Over Hunter",
    family: "OVER",
    summary: "Trades Over 2 and Over 3 when low digits dominate.",
    strategies: ["OVER_2", "OVER_3"],
    master: false,
  },
  {
    id: "even-odd-hunter",
    name: "Even/Odd Hunter",
    family: "EVEN/ODD",
    summary: "Follows even/odd bias on the assigned synthetic.",
    strategies: ["EVEN_ODD"],
    master: false,
  },
  {
    id: "entrypoint-hunter",
    name: "Entrypoint Hunter",
    family: "MASTER",
    summary: "Only arms when digit-bias reaches SIGNAL on a watched market.",
    strategies: ["UNDER_7", "OVER_2", "OVER_3", "UNDER_8", "EVEN_ODD"],
    master: true,
  },
];

export const LOADED_BOT_STORAGE_KEY = "deriv.intelligence.loaded-bot";

export function readLoadedBotId(): string {
  if (typeof sessionStorage === "undefined") {
    return "autoswitcher";
  }
  return sessionStorage.getItem(LOADED_BOT_STORAGE_KEY) ?? "autoswitcher";
}

export function writeLoadedBotId(id: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(LOADED_BOT_STORAGE_KEY, id);
}

export function presetById(id: string): FreeBotPreset {
  return FREE_BOT_PRESETS.find((item) => item.id === id) ?? FREE_BOT_PRESETS[0];
}
