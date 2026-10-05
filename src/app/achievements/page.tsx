import { addAchievementAction } from "../actions";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { listAchievements, listProjects } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function AchievementsPage() {
  const [items, projects] = await Promise.all([listAchievements(), listProjects()]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Achievements</h1>
      <p className="text-sm text-slate-500">Keep wording generic: no confidential figures or customer names.</p>
      <Card>
        <form action={addAchievementAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Title"><input name="title" required className={inputCls} /></Field>
          <Field label="Metric (optional)"><input name="metric" placeholder="e.g. +12% conversion" className={inputCls} /></Field>
          <div className="sm:col-span-2">
            <Field label="What was done"><textarea name="whatWasDone" required rows={2} className={inputCls} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="CV bullet (optional)"><input name="cvBullet" className={inputCls} /></Field>
          </div>
          <Field label="Project (optional)">
            <select name="projectId" defaultValue="" className={inputCls}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="self-end"><button className={btnCls}>Add achievement</button></div>
        </form>
      </Card>
      <ul className="space-y-2">
        {items.length === 0 && <li className="text-slate-500">Nothing logged yet.</li>}
        {items.map((a) => (
          <li key={a.id} className="rounded-lg border bg-white p-3 text-sm">
            <div className="font-medium">{a.title} <span className="font-normal text-slate-500">{a.achievedOn}</span></div>
            <div>{a.whatWasDone}</div>
            {a.metric && <div className="text-slate-600">Metric: {a.metric}</div>}
            {a.cvBullet && <div className="text-slate-600">CV: {a.cvBullet}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
