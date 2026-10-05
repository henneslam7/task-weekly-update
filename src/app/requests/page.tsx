import { logRequestAction } from "../actions";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { listProjects, listRequests, OUTCOMES } from "@/lib/services";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const [requests, projects] = await Promise.all([listRequests(), listProjects()]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Requests</h1>
      <Card>
        <form action={logRequestAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><input name="fromPerson" required className={inputCls} /></Field>
          <Field label="Outcome">
            <select name="outcome" defaultValue="redirected" className={inputCls}>
              {OUTCOMES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Summary"><textarea name="summary" required rows={2} className={inputCls} /></Field>
          </div>
          <Field label="Redirected to (required if redirected)">
            <input name="redirectedTo" defaultValue="Nicholas" className={inputCls} />
          </Field>
          <Field label="Related project (optional)">
            <select name="projectId" defaultValue="" className={inputCls}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div><button className={btnCls}>Log request</button></div>
        </form>
      </Card>
      <ul className="space-y-2">
        {requests.length === 0 && <li className="text-slate-500">No requests logged.</li>}
        {requests.map((r) => (
          <li key={r.id} className="rounded-lg border bg-white p-3 text-sm">
            <div className="font-medium">{r.fromPerson} <span className="font-normal text-slate-500">{r.receivedOn}</span></div>
            <div>{r.summary}</div>
            <div className="text-slate-600">
              {r.outcome}{r.redirectedTo ? ` to ${r.redirectedTo}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
