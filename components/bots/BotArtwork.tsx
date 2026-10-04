import type { CSSProperties } from "react";
import type { BotArtworkKind, BotGalleryTheme } from "@/components/bots/free-bots-catalog";

const FRAME_STYLE: CSSProperties = {
  position: "relative",
  width: "100%",
  height: 160,
  overflow: "hidden",
  flexShrink: 0,
};

const SVG_STYLE: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: "100%",
  height: "100%",
  maxWidth: "100%",
  maxHeight: "100%",
};

const SVG_PROPS = {
  viewBox: "0 0 320 176",
  width: "100%",
  height: "100%",
  preserveAspectRatio: "xMidYMid meet",
  className: "absolute inset-0 block h-full max-h-full w-full max-w-full",
  style: SVG_STYLE,
  "aria-hidden": true as const,
};

export function BotArtwork({
  kind,
  theme,
}: {
  kind: BotArtworkKind;
  theme: BotGalleryTheme;
}) {
  const stroke = strokeFor(theme);

  return (
    <div className="relative h-[160px] w-full shrink-0 overflow-hidden" style={FRAME_STYLE}>
      <div className="absolute inset-0 opacity-80" style={{ ...SVG_STYLE, opacity: 0.8 }}>
        {kind === "network" ? <NetworkArt stroke={stroke} /> : null}
        {kind === "radar" ? <RadarArt stroke={stroke} /> : null}
        {kind === "under" ? <GridArt stroke={stroke} direction="down" /> : null}
        {kind === "over" ? <GridArt stroke={stroke} direction="up" /> : null}
        {kind === "split" ? <SplitArt /> : null}
      </div>
    </div>
  );
}

function strokeFor(theme: BotGalleryTheme): string {
  switch (theme) {
    case "cyan":
      return "#67e8f9";
    case "violet":
      return "#c4b5fd";
    case "rose":
      return "#fda4af";
    case "magenta":
      return "#f0abfc";
    case "amber":
      return "#fdba74";
    case "gold":
      return "#fcd34d";
    default:
      return "#a5b4fc";
  }
}

function NetworkArt({ stroke }: { stroke: string }) {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="160" cy="88" r="18" fill={`${stroke}22`} stroke={stroke} strokeWidth="1.5" />
      <circle cx="160" cy="88" r="6" fill={stroke} />
      {[
        [48, 36],
        [72, 140],
        [248, 32],
        [270, 128],
        [120, 28],
        [200, 150],
      ].map(([x, y], index) => (
        <g key={index}>
          <line x1="160" y1="88" x2={x} y2={y} stroke={stroke} strokeOpacity="0.45" />
          <circle cx={x} cy={y} r="5" fill={`${stroke}33`} stroke={stroke} />
        </g>
      ))}
    </svg>
  );
}

function RadarArt({ stroke }: { stroke: string }) {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="160" cy="92" r="62" fill="none" stroke={stroke} strokeOpacity="0.2" />
      <circle cx="160" cy="92" r="42" fill="none" stroke={stroke} strokeOpacity="0.35" />
      <circle cx="160" cy="92" r="22" fill="none" stroke={stroke} strokeOpacity="0.6" />
      <circle cx="160" cy="92" r="5" fill={stroke} />
      <path d="M160 92 L210 48" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function GridArt({
  stroke,
  direction,
}: {
  stroke: string;
  direction: "up" | "down";
}) {
  const d =
    direction === "down"
      ? "M40 36 L90 70 L140 58 L200 110 L280 148"
      : "M40 140 L100 110 L150 118 L210 64 L280 36";
  return (
    <svg {...SVG_PROPS}>
      {[0, 1, 2, 3, 4].map((row) =>
        [0, 1, 2, 3, 4, 5].map((col) => (
          <text
            key={`${row}-${col}`}
            x={36 + col * 48}
            y={32 + row * 28}
            fill={stroke}
            opacity="0.28"
            fontSize="11"
            fontFamily="ui-monospace, monospace"
          >
            {(row * 2 + col) % 10}
          </text>
        )),
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="2.5" />
    </svg>
  );
}

function SplitArt() {
  return (
    <svg {...SVG_PROPS}>
      <text x="58" y="112" fill="#34d399" fontSize="72" fontWeight="700">
        E
      </text>
      <line x1="160" y1="28" x2="160" y2="148" stroke="#64748b" strokeDasharray="4 6" />
      <text x="188" y="112" fill="#fb7185" fontSize="72" fontWeight="700">
        O
      </text>
    </svg>
  );
}
