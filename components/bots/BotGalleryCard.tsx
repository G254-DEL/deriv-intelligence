import { BotArtwork } from "@/components/bots/BotArtwork";
import { BotStatusBadge } from "@/components/bots/BotStatusBadge";
import {
  THEME_STYLES,
  type FreeBotGalleryItem,
} from "@/components/bots/free-bots-catalog";

export type GalleryCardState = {
  loaded: boolean;
  status: string;
  assignedMarket?: string;
  confidence?: string;
  ready?: boolean;
  reason?: string;
};

export function BotGalleryCard({
  item,
  state,
  onLoad,
}: {
  item: FreeBotGalleryItem;
  state: GalleryCardState;
  onLoad: () => void;
}) {
  const theme = THEME_STYLES[item.theme];

  return (
    <article
      className={`flex w-full min-w-0 flex-col self-start overflow-hidden rounded-2xl border bg-[#141922] shadow-[0_12px_40px_rgba(0,0,0,0.28)] transition duration-200 hover:-translate-y-0.5 ${theme.border}`}
      style={{ width: "100%", minWidth: 0, alignSelf: "start", overflow: "hidden" }}
    >
      <div
        className={`relative shrink-0 overflow-hidden bg-gradient-to-br ${theme.glow}`}
        style={{ position: "relative", flexShrink: 0, overflow: "hidden" }}
      >
        <BotArtwork kind={item.artwork} theme={item.theme} />
        <div className="absolute left-2.5 top-2.5" style={{ position: "absolute", top: 10, left: 10 }}>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${theme.badge}`}
          >
            {item.family}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-4">
        <div>
          <h3 className="text-lg font-semibold leading-tight tracking-tight text-foreground">
            {item.name}
          </h3>
          <p className="mt-1 line-clamp-3 text-sm leading-5 text-muted">{item.description}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <BotStatusBadge label={item.contractBadge} />
          <BotStatusBadge
            label={state.status}
            tone={state.ready ? "armed" : state.loaded ? "live" : "idle"}
          />
        </div>

        {state.loaded && (state.assignedMarket || state.reason) ? (
          <p
            className="flex min-w-0 items-baseline justify-between gap-2 text-xs text-muted"
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              minWidth: 0,
              margin: 0,
            }}
          >
            <span className="min-w-0 truncate" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {state.reason ? `${state.assignedMarket ?? "Waiting"} · ${state.reason}` : state.assignedMarket}
            </span>
            {state.confidence ? (
              <span className="shrink-0 font-mono text-foreground" style={{ flexShrink: 0 }}>
                {state.confidence}
              </span>
            ) : null}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onLoad}
          className={`w-full rounded-lg px-3 py-2 text-sm font-medium transition ${theme.button}`}
        >
          {state.loaded ? "✓ Loaded" : "Load bot"}
        </button>
      </div>
    </article>
  );
}
