import { notFound } from "next/navigation";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { StrategiesPage } from "@/components/StrategiesPage";
import AnalysisPage from "@/components/AnalysisPage";
import { NAV_ITEMS } from "@/lib/navigation";

type SectionPageProps = {
  params: Promise<{ section: string }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;
  const item = NAV_ITEMS.find((nav) => nav.href === `/${section}`);

  if (!item || !item.ready) {
    notFound();
  }

  if (item.href === "/strategies") return <StrategiesPage />;
  if (item.href === "/analysis") return <AnalysisPage />;
  return <PlaceholderPage title={item.label} />;
}


