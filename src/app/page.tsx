import Link from "next/link";
import { saveProjectAction } from "./actions";
import { Card, Field, Rag, btnCls, inputCls } from "@/components/ui";
import { getWeekSummary, PRIORITIES } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const s = await getWeekSummary();
  const missing = new Set(s.missing.map((p) => p.id));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Week of {s.weekStart}</h1>
        <p className="text-sm text-slate-500">
          {s.weekStart} to {s.weekEnd}. {s.missing.length ? `${s.missing.length} project(s) missing an update.` : "All updates in."}
        </p>
      </div>

      <div className="space-y-2">
        {s.projects.length === 0 && <p className="text-slate-500">No projects yet. Add one below.</p>}
        {s.projects.map(({ project: p, update }) => (
          <Link key={p.id} href={`/projects/${p.id}?week=${s.weekStart}`} className="block rounded-lg border bg-white p-4 hover:border-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-slate-500">{p.priority}</span>
              <Rag value={update?.rag ?? p.status} />
              <span className="text-xs text-slate-500">{p.progressPct}%</span>
              {missing.has(p.id) && <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">Missing update</span>}
            </div>
            {update?.progress && <p className="mt-1 text-sm text-slate-600">{update.progress}</p>}
          </Link>
        ))}
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Add project</h2>
        <form action={saveProjectAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input name="name" required className={inputCls} />
          </Field>
          <Field label="Priority">
            <select name="priority" defaultValue="P2" className={inputCls}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Requester">
            <input name="requester" className={inputCls} />
          </Field>
          <Field label="Due date">
            <input name="dueDate" type="date" className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <input name="description" className={inputCls} />
            </Field>
          </div>
          <div><button className={btnCls}>Add project</button></div>
        </form>
      </Card>
    </div>
  );
}
