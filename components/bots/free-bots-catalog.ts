import type { BotStrategy } from "@/src/lib/trading/types";

export type BotGalleryTheme =
  | "cyan"
  | "violet"
  | "rose"
  | "magenta"
  | "amber"
  | "gold"
  | "indigo";

export type BotArtworkKind =
  | "network"
  | "radar"
  | "under"
  | "over"
  | "split";

export type FreeBotGalleryItem = {
  galleryId: string;
  presetId: string;
  name: string;
  family: "MASTER" | "SPECIALIST";
  theme: BotGalleryTheme;
  artwork: BotArtworkKind;
  contractBadge: string;
  description: string;
  specialist?: BotStrategy;
};

export const FREE_BOT_GALLERY: FreeBotGalleryItem[] = [
  {
    galleryId: "autoswitcher",
    presetId: "autoswitcher",
    name: "Market Router",
    family: "MASTER",
    theme: "cyan",
    artwork: "network",
    contractBadge: "Market router",
    description:
      "Scans live Deriv markets and routes the strongest setups to specialist bots.",
  },
  {
    galleryId: "entrypoint-hunter",
    presetId: "entrypoint-hunter",
    name: "Entry Signal Hunter",
    family: "MASTER",
    theme: "violet",
    artwork: "radar",
    contractBadge: "Entry gate",
    description:
      "Watches candidate setups and holds for SIGNAL / ready conditions before paper entry.",
  },
  {
    galleryId: "under-7-hunter",
    presetId: "under-hunter",
    name: "Under 7 Hunter",
    family: "SPECIALIST",
    theme: "rose",
    artwork: "under",
    contractBadge: "DIGITUNDER 7",
    description: "DIGITUNDER specialist for barrier 7 on its assigned synthetic.",
    specialist: "UNDER_7",
  },
  {
    galleryId: "under-8-hunter",
    presetId: "under-hunter",
    name: "Under 8 Hunter",
    family: "SPECIALIST",
    theme: "magenta",
    artwork: "under",
    contractBadge: "DIGITUNDER 8",
    description: "DIGITUNDER specialist for barrier 8 on its assigned synthetic.",
    specialist: "UNDER_8",
  },
  {
    galleryId: "over-2-hunter",
    presetId: "over-hunter",
    name: "Over 2 Hunter",
    family: "SPECIALIST",
    theme: "amber",
    artwork: "over",
    contractBadge: "DIGITOVER 2",
    description: "DIGITOVER specialist for barrier 2 on its assigned synthetic.",
    specialist: "OVER_2",
  },
  {
    galleryId: "over-3-hunter",
    presetId: "over-hunter",
    name: "Over 3 Hunter",
    family: "SPECIALIST",
    theme: "gold",
    artwork: "over",
    contractBadge: "DIGITOVER 3",
    description: "DIGITOVER specialist for barrier 3 on its assigned synthetic.",
    specialist: "OVER_3",
  },
  {
    galleryId: "even-odd-hunter",
    presetId: "even-odd-hunter",
    name: "Even/Odd Hunter",
    family: "SPECIALIST",
    theme: "indigo",
    artwork: "split",
    contractBadge: "DIGITEVEN / DIGITODD",
    description:
      "Selects even or odd paper contracts from the assigned market’s digit sample.",
    specialist: "EVEN_ODD",
  },
];

export const THEME_STYLES: Record<
  BotGalleryTheme,
  {
    glow: string;
    border: string;
    badge: string;
    button: string;
    ink: string;
  }
> = {
  cyan: {
    glow: "from-cyan-500/25 via-sky-500/10 to-transparent",
    border: "border-cyan-400/25 hover:border-cyan-300/50",
    badge: "bg-cyan-400/15 text-cyan-200",
    button: "bg-cyan-500/20 text-cyan-100 hover:bg-cyan-400/30",
    ink: "text-cyan-200",
  },
  violet: {
    glow: "from-violet-500/30 via-fuchsia-500/10 to-transparent",
    border: "border-violet-400/25 hover:border-violet-300/50",
    badge: "bg-violet-400/15 text-violet-200",
    button: "bg-violet-500/20 text-violet-100 hover:bg-violet-400/30",
    ink: "text-violet-200",
  },
  rose: {
    glow: "from-rose-500/30 via-red-500/10 to-transparent",
    border: "border-rose-400/25 hover:border-rose-300/50",
    badge: "bg-rose-400/15 text-rose-200",
    button: "bg-rose-500/20 text-rose-100 hover:bg-rose-400/30",
    ink: "text-rose-200",
  },
  magenta: {
    glow: "from-fuchsia-500/30 via-pink-500/10 to-transparent",
    border: "border-fuchsia-400/25 hover:border-pink-300/50",
    badge: "bg-fuchsia-400/15 text-fuchsia-200",
    button: "bg-fuchsia-500/20 text-fuchsia-100 hover:bg-fuchsia-400/30",
    ink: "text-fuchsia-200",
  },
  amber: {
    glow: "from-orange-500/30 via-amber-500/10 to-transparent",
    border: "border-orange-400/25 hover:border-amber-300/50",
    badge: "bg-orange-400/15 text-orange-100",
    button: "bg-orange-500/20 text-orange-100 hover:bg-orange-400/30",
    ink: "text-orange-200",
  },
  gold: {
    glow: "from-amber-400/30 via-yellow-600/10 to-transparent",
    border: "border-amber-300/25 hover:border-amber-200/50",
    badge: "bg-amber-400/15 text-amber-100",
    button: "bg-amber-500/20 text-amber-100 hover:bg-amber-400/30",
    ink: "text-amber-200",
  },
  indigo: {
    glow: "from-indigo-500/30 via-emerald-500/10 to-transparent",
    border: "border-indigo-400/25 hover:border-indigo-300/50",
    badge: "bg-indigo-400/15 text-indigo-200",
    button: "bg-indigo-500/20 text-indigo-100 hover:bg-indigo-400/30",
    ink: "text-indigo-200",
  },
};
