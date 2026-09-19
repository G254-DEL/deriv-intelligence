import { Card } from "@/components/ui/Card";
import { UI_PREVIEW_LABEL, botStatus } from "@/lib/demo-data";

export function BotStatusPanel() {
  return (
    <Card title="Bot Status" badge={UI_PREVIEW_LABEL}>
      <ul className="divide-y divide-border rounded-md border border-border">
        {botStatus.map((item) => (
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
        Trading and automation are disabled in this UI milestone. No orders can
        be placed from this screen.
      </p>
    </Card>
  );
}
