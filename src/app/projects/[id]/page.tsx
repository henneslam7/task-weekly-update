import { notFound } from "next/navigation";
import { saveProjectAction, saveUpdateAction } from "../../actions";
import { Card, Field, Rag, btnCls, inputCls } from "@/components/ui";
import { findProject, getWeekSummary, PRIORITIES, PROJECT_STATUSES, RAGS, RELEASE_DATE_TYPES, STATUS_LABELS } from "@/lib/services";
import { resolveWeekStart } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const { week } = await searchParams;
  const project = await findProject(id).catch(() => null);
  if (!project) notFound();
  let weekStart: string;
  try {
    weekStart = resolveWeekStart(week);
  } catch {
    notFound();
  }
  const s = await getWeekSummary({ weekStart });
  const row = s.projects.find((r) => r.project.id === project.id);
  const u = row?.update;
  const defaultRag = u?.rag ?? (project.status === "done" ? "green" : project.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <Rag value={u?.rag ?? project.status} />
        <span className="text-sm text-slate-500">{project.priority} / {project.progressPct}%</span>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Update for week of {weekStart}</h2>
        <form action={saveUpdateAction} className="space-y-3">
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="weekStart" value={weekStart} />
          <Field label="Wins"><textarea name="wins" rows={2} defaultValue={u?.wins ?? ""} className={inputCls} /></Field>
          <Field label="Progress this week (Excel column)"><textarea name="progressThisWeek" rows={2} defaultValue={u?.progressThisWeek ?? ""} className={inputCls} /></Field>
          <Field label="Progress (older field)"><textarea name="progress" rows={2} defaultValue={u?.progress ?? ""} className={inputCls} /></Field>
          <Field label="Next steps"><textarea name="nextSteps" rows={2} defaultValue={u?.nextSteps ?? ""} className={inputCls} /></Field>
          <Field label="Blockers"><textarea name="blockers" rows={2} defaultValue={u?.blockers ?? ""} className={inputCls} /></Field>
          <Field label="Support needed"><textarea name="supportNeeded" rows={2} defaultValue={u?.supportNeeded ?? ""} className={inputCls} /></Field>
          <Field label="RAG">
            <select name="rag" defaultValue={defaultRag} className={inputCls}>
              {RAGS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <button className={btnCls}>Save update</button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Project details</h2>
        <form action={saveProjectAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="name" value={project.name} />
          <input type="hidden" name="archivedPresent" value="1" />
          <Field label="Priority">
            <select name="priority" defaultValue={project.priority} className={inputCls}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={project.status} className={inputCls}>
              {PROJECT_STATUSES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Progress %">
            <input name="progressPct" type="number" min={0} max={100} defaultValue={project.progressPct} className={inputCls} />
          </Field>
          <Field label="Due date">
            <input name="dueDate" type="date" defaultValue={project.dueDate ?? ""} className={inputCls} />
          </Field>
          <Field label="Requester">
            <input name="requester" defaultValue={project.requester ?? ""} className={inputCls} />
          </Field>
          <Field label="Status (team sheet)">
            <select name="statusLabel" defaultValue={project.statusLabel ?? ""} className={inputCls}>
              <option value="">(not set)</option>
              {STATUS_LABELS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Owner short name">
            <input name="ownerShortName" defaultValue={project.ownerShortName ?? ""} className={inputCls} />
          </Field>
          <Field label="Release date">
            <input name="releaseDate" type="date" defaultValue={project.releaseDate ?? ""} className={inputCls} />
          </Field>
          <Field label="Release date type">
            <select name="releaseDateType" defaultValue={project.releaseDateType ?? ""} className={inputCls}>
              <option value="">(not set)</option>
              {RELEASE_DATE_TYPES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Release date note (TBA, TBC ...)">
            <input name="releaseDateNote" defaultValue={project.releaseDateNote ?? ""} className={inputCls} />
          </Field>
          <Field label="Queue order">
            <input name="queueOrder" type="number" defaultValue={project.queueOrder ?? ""} className={inputCls} />
          </Field>
          <Field label="Description">
            <input name="description" defaultValue={project.description ?? ""} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="archived" defaultChecked={project.archived} /> Archived
          </label>
          <div className="sm:col-span-2"><button className={btnCls}>Save details</button></div>
        </form>
      </Card>
    </div>
  );
}
