import { Card } from "@/components/ui/Card";

type PlaceholderPageProps = {
  title: string;
};

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card title={title} badge="Placeholder">
        <p className="text-sm leading-6 text-muted">
          This section is a visual placeholder for later milestones. The
          Dashboard is the only functional page in this UI preview. No market
          data, authentication, or trading is connected yet.
        </p>
      </Card>
    </div>
  );
}
