import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { addDays, resolveWeekStart } from "@/lib/week";
import { getWeekSummary, renderMarkdown } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  let weekStart: string;
  try {
    weekStart = resolveWeekStart(week);
  } catch {
    notFound();
  }
  const md = renderMarkdown(await getWeekSummary({ weekStart }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Week summary</h1>
        <Link className="text-sm underline" href={`/summary?week=${addDays(weekStart, -7)}`}>Previous week</Link>
        <Link className="text-sm underline" href={`/summary?week=${addDays(weekStart, 7)}`}>Next week</Link>
        <span className="ml-auto"><CopyButton text={md} /></span>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border bg-white p-4 text-sm">{md}</pre>
    </div>
  );
}
