import { Card } from "@/components/ui/Card";
import { connectionLabel, type DerivConnectionState } from "@/src/lib/deriv";

type BotStatusPanelProps = {
  live: boolean;
  connectionState: DerivConnectionState;
};

export function BotStatusPanel({ live, connectionState }: BotStatusPanelProps) {
  const items = [
    {
      label: "Public market data",
      value: connectionLabel(connectionState).replace("Deriv Market Data: ", ""),
    },
    { label: "Paper Trading", value: "OFF" },
    { label: "Automatic Trading", value: "OFF" },
    { label: "Live orders", value: "OFF" },
  ];

  return (
    <Card title="Bot Status" badge={live ? "Live" : "Offline"}>
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-4 px-3 py-3 text-sm"
          >
            <span className="text-muted">{item.label}</span>
            <span className="font-medium text-foreground">{item.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Automatic trading and live buy/sell stay disabled. Use Market Scanner for
        quotes and manual paper trades after the public stream is connected.
      </p>
    </Card>
  );
}
