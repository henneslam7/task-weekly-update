import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/CopyButton";
import { ExportPanel } from "@/components/ExportPanel";
import { Card } from "@/components/ui";
import { addDays, resolveWeekStart } from "@/lib/week";
import { getWeekSummary, listExportRuns, renderMarkdown } from "@/lib/services";

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
  let runs: Awaited<ReturnType<typeof listExportRuns>> = [];
  try {
    runs = await listExportRuns(10);
  } catch {
    // keep the page usable if the export tables are unavailable
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Week summary</h1>
        <Link className="text-sm underline" href={`/summary?week=${addDays(weekStart, -7)}`}>Previous week</Link>
        <Link className="text-sm underline" href={`/summary?week=${addDays(weekStart, 7)}`}>Next week</Link>
        <span className="ml-auto"><CopyButton text={md} /></span>
      </div>
      <Card>
        <h2 className="mb-2 font-semibold">Export deck (week of {weekStart})</h2>
        <ExportPanel weekStart={weekStart} />
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Past exports</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No exports yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3">
                <span>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                <span>{r.format}</span>
                <span>week {r.weekStart}</span>
                <span className={r.status === "failed" ? "text-red-700" : ""}>{r.status}</span>
                {r.status === "done" && r.fileId && (
                  <a className="underline" href={`/api/export/download?run=${r.id}`}>Download</a>
                )}
                {r.error && <span className="text-red-700">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border bg-white p-4 text-sm">{md}</pre>
    </div>
  );
}
