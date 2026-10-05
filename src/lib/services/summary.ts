import { resolveWeekStart, weekEnd } from "../week";
import { listAchievements, type Achievement } from "./achievements";
import { listProjects, type Project } from "./projects";
import { listRequests, type RequestEntry } from "./requests";
import { isActive, listUpdatesForWeek, type WeeklyUpdate } from "./updates";

export type WeekSummary = {
  weekStart: string;
  weekEnd: string;
  projects: { project: Project; update: WeeklyUpdate | null; tasks: WeeklyUpdate[]; blockers: WeeklyUpdate[] }[];
  missing: Project[];
  requests: RequestEntry[];
  achievements: Achievement[];
};

export async function getWeekSummary(opts: { weekStart?: string; now?: Date } = {}): Promise<WeekSummary> {
  const weekStart = resolveWeekStart(opts.weekStart, opts.now);
  const end = weekEnd(weekStart);
  const [projects, updates, requests, achievements] = await Promise.all([
    listProjects(),
    listUpdatesForWeek(weekStart),
    listRequests({ from: weekStart, to: end }),
    listAchievements({ from: weekStart, to: end }),
  ]);
  const rows = projects
    .map((project) => {
      const mine = updates.filter((u) => u.projectId === project.id);
      return {
        project,
        update: mine.find((u) => u.kind === "progress") ?? null,
        tasks: mine.filter((u) => u.kind === "task"),
        blockers: mine.filter((u) => u.kind === "blocker"),
      };
    })
    .filter((r) => isActive(r.project) || r.update || r.tasks.length || r.blockers.length);
  return {
    weekStart,
    weekEnd: end,
    projects: rows,
    missing: rows.filter((r) => isActive(r.project) && !r.update).map((r) => r.project),
    requests,
    achievements,
  };
}

const rag = (r: string | null | undefined) => (r ? r.toUpperCase() : "n/a");

export function renderMarkdown(s: WeekSummary): string {
  const out: string[] = [`# Weekly update: ${s.weekStart} to ${s.weekEnd}`, ""];
  const wins = s.projects.filter((r) => r.update?.wins).map((r) => `- ${r.project.name}: ${r.update!.wins}`);
  out.push("## Wins", ...(wins.length ? wins : ["- None logged"]), "");

  out.push("## Project status", "");
  if (!s.projects.length) out.push("- No projects");
  for (const r of s.projects) {
    const u = r.update;
    out.push(
      `### ${r.project.name} (${r.project.priority}, ${rag(u?.rag ?? r.project.status)}, ${r.project.progressPct}%)`,
    );
    if (!u) out.push("- No update logged this week");
    else {
      if (u.progress) out.push(`- Progress: ${u.progress}`);
      if (u.nextSteps) out.push(`- Next: ${u.nextSteps}`);
      if (u.blockers) out.push(`- Blockers: ${u.blockers}`);
      if (u.supportNeeded) out.push(`- Support needed: ${u.supportNeeded}`);
    }
    for (const t of r.tasks) out.push(`- Task [${t.status}]: ${t.title}`);
    for (const b of r.blockers) out.push(`- Blocker [${b.status}]: ${b.title}`);
    out.push("");
  }

  const redirected = s.requests.filter((r) => r.outcome === "redirected").length;
  out.push("## Requests", "");
  if (!s.requests.length) out.push("- None this week");
  for (const r of s.requests) {
    const to = r.outcome === "redirected" && r.redirectedTo ? ` to ${r.redirectedTo}` : "";
    out.push(`- ${r.receivedOn} ${r.fromPerson}: ${r.summary} (${r.outcome}${to})`);
  }
  if (s.requests.length) out.push(``, `New requests redirected: ${redirected} of ${s.requests.length}.`);
  out.push("");

  if (s.achievements.length) {
    out.push("## Achievements", "");
    for (const a of s.achievements) out.push(`- ${a.title}: ${a.whatWasDone}${a.metric ? ` (${a.metric})` : ""}`);
    out.push("");
  }
  if (s.missing.length) out.push("## Missing updates", ...s.missing.map((p) => `- ${p.name}`), "");
  return out.join("\n").trimEnd() + "\n";
}

export async function exportMarkdown(opts: { weekStart?: string; now?: Date } = {}): Promise<string> {
  return renderMarkdown(await getWeekSummary(opts));
}
