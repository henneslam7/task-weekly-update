import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isMonday } from "../week";
import { exportWeeklyDeck } from "../services/export";
import { exportWeeklySheet } from "../services/exportSheet";
import { getWorkspaceSettings, updateWorkspaceSettings } from "../services/workspace";
import {
  addAchievement,
  exportMarkdown,
  getWeekSummary,
  listAchievements,
  listMissingUpdates,
  listProjects,
  logRequest,
  logWeeklyUpdate,
  upsertProject,
  OUTCOMES,
  PRIORITIES,
  PROJECT_STATUSES,
  RAGS,
  RELEASE_DATE_TYPES,
  STATUS_LABELS,
  type Project,
} from "../services";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

/** Turn any thrown error into a short readable tool error (never a stack trace). */
export function toolError(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = /duplicate key|violates|ECONN|fetch failed|DATABASE_URL/i.test(msg)
    ? `Storage error: ${msg.split("\n")[0].slice(0, 200)}`
    : msg.split("\n")[0];
  return { isError: true, content: [{ type: "text", text: `Error: ${clean}` }] };
}

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    return toolError(e);
  }
}

const weekStart = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "week_start must be YYYY-MM-DD")
  .refine((s) => {
    try {
      return isMonday(s);
    } catch {
      return false;
    }
  }, "week_start must be a Monday (YYYY-MM-DD)")
  .optional()
  .describe(
    "Monday of the week, YYYY-MM-DD. Omit for the default: the current week, or the previous week when called on a Monday.",
  );
const ymd = (what: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").describe(what);

/** Resolve a project reference loosely: exact name, unique substring, or all words contained. */
export async function resolveProjectRef(ref: string): Promise<Project> {
  const all = await listProjects({ includeArchived: true });
  const q = ref.trim().toLowerCase();
  const names = () => all.map((p) => p.name).join(", ") || "(none)";
  const exact = all.filter((p) => p.name.toLowerCase() === q || p.id === q);
  if (exact.length === 1) return exact[0];
  const sub = all.filter((p) => p.name.toLowerCase().includes(q) || (q.includes(p.name.toLowerCase()) && p.name.length > 2));
  const words = q.split(/\s+/).filter(Boolean);
  const byWords = all.filter((p) => words.length > 0 && words.every((w) => p.name.toLowerCase().includes(w)));
  const hits = sub.length ? sub : byWords;
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new Error(`Project "${ref}" is ambiguous: ${hits.map((p) => p.name).join(", ")}. Use the full name.`);
  }
  throw new Error(`Project "${ref}" not found. Known projects: ${names()}. Use upsert_project to create it.`);
}

const RO = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function cvBullets(items: Awaited<ReturnType<typeof listAchievements>>): string {
  if (!items.length) return "No achievements logged for this period.";
  return items
    .map((a) => `- ${a.cvBullet?.trim() || `${a.title}: ${a.whatWasDone}${a.metric ? ` (${a.metric})` : ""}`}`)
    .join("\n");
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the owner's projects with priority, status (green/amber/red/done...), progress % and due date. Call this first to see exact project names before logging updates.",
      inputSchema: z.object({
        include_archived: z.boolean().optional().describe("Include archived projects. Default false."),
      }),
      annotations: RO,
    },
    ({ include_archived }) => safe(async () => json(await listProjects({ includeArchived: include_archived }))),
  );

  server.registerTool(
    "upsert_project",
    {
      title: "Create or update a project",
      description:
        "Create a project, or update it if one with the same name (case-insensitive) exists. Only the fields you pass are changed. Returns the saved project.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Project name. Used as the unique key."),
        description: z.string().optional(),
        priority: z.enum(PRIORITIES).optional().describe("P1 is highest."),
        status: z.enum(PROJECT_STATUSES).optional(),
        progress_pct: z.number().int().min(0).max(100).optional().describe("Overall completion 0-100."),
        due_date: ymd("Due date YYYY-MM-DD.").optional(),
        requester: z.string().optional().describe("Who asked for it. Free text, may contain '/' and brackets."),
        owner_short_name: z.string().optional().describe("Short owner name for the team Excel sheet's Owner column, e.g. 'Hennes'."),
        status_label: z
          .enum(STATUS_LABELS)
          .optional()
          .describe("Team-sheet Status: To Start, On track, At risk, Blocked or Done. Set explicitly; it is NOT the same as RAG/status colour."),
        release_date: ymd("Release date YYYY-MM-DD (planned or delivered, see release_date_type).").nullable().optional(),
        release_date_type: z
          .enum(RELEASE_DATE_TYPES)
          .nullable()
          .optional()
          .describe("'target' = planned, shown as (Target Date: M/D/YYYY); 'actual' = delivered, shown as dd/MM/yyyy."),
        release_date_note: z
          .string()
          .optional()
          .describe("Free text used when there is no date, e.g. 'TBA', 'TBC', 'within Nov'."),
        queue_order: z.number().int().optional().describe("Order within the same priority in the Excel block (1 = first)."),
        new_name: z.string().min(1).optional().describe("Rename the project called `name` to this."),
        archived: z.boolean().optional(),
      }),
      annotations: WR,
    },
    (a) =>
      safe(async () => {
        const existing = (await listProjects({ includeArchived: true })).find(
          (p) => p.name.toLowerCase() === a.name.trim().toLowerCase(),
        );
        return json(
          await upsertProject({
            name: existing?.name ?? a.name,
            newName: a.new_name,
            ownerShortName: a.owner_short_name,
            statusLabel: a.status_label,
            releaseDate: a.release_date,
            releaseDateType: a.release_date_type,
            releaseDateNote: a.release_date_note,
            queueOrder: a.queue_order,
            description: a.description,
            priority: a.priority,
            status: a.status,
            progressPct: a.progress_pct,
            dueDate: a.due_date,
            requester: a.requester,
            archived: a.archived,
          }),
        );
      }),
  );

  server.registerTool(
    "log_weekly_update",
    {
      title: "Log a weekly project update",
      description:
        "Save this week's update for ONE project (one record per project per week; calling again updates it, omitted fields keep their value). The project name is matched loosely (e.g. 'ST sub' finds 'ST sub-domain'). Returns the saved record.",
      inputSchema: z.object({
        project: z.string().min(1).describe("Project name (fuzzy) or id."),
        week_start: weekStart,
        wins: z.string().optional().describe("What went well / was delivered."),
        progress: z.string().optional().describe("What was done this week (older free-text field; still supported)."),
        progress_this_week: z
          .string()
          .optional()
          .describe("Text for the team sheet's 'Progress this week' column, e.g. '10% complete. Started designing the Gifting page; first draft in progress.'"),
        next_steps: z.string().optional(),
        blockers: z.string().optional().describe("What is blocking progress."),
        support_needed: z.string().optional(),
        rag: z.enum(RAGS).optional().describe("Status: green, amber or red."),
      }),
      annotations: WR,
    },
    (a) =>
      safe(async () => {
        const p = await resolveProjectRef(a.project);
        return json(
          await logWeeklyUpdate({
            project: p.id,
            weekStart: a.week_start,
            wins: a.wins,
            progress: a.progress,
            progressThisWeek: a.progress_this_week,
            nextSteps: a.next_steps,
            blockers: a.blockers,
            supportNeeded: a.support_needed,
            rag: a.rag,
          }),
        );
      }),
  );

  server.registerTool(
    "get_week_summary",
    {
      title: "Get week summary",
      description:
        "Everything for one week: per-project update, missing updates, requests and achievements. Use it to review and show the owner a draft before exporting.",
      inputSchema: z.object({ week_start: weekStart }),
      annotations: RO,
    },
    ({ week_start }) => safe(async () => json(await getWeekSummary({ weekStart: week_start }))),
  );

  server.registerTool(
    "list_missing_updates",
    {
      title: "List missing updates",
      description: "Active projects that have no weekly update logged for the week. Ask the owner about these.",
      inputSchema: z.object({ week_start: weekStart }),
      annotations: RO,
    },
    ({ week_start }) => safe(async () => json(await listMissingUpdates({ weekStart: week_start }))),
  );

  server.registerTool(
    "log_request",
    {
      title: "Log an incoming request",
      description:
        "Record a request someone made and what happened to it. Idempotent per day+person+summary (logging again updates the outcome). 'redirected' requires redirected_to. Returns the saved record.",
      inputSchema: z.object({
        from_person: z.string().min(1).describe("Who asked."),
        summary: z.string().min(1).describe("What they asked for."),
        outcome: z.enum(OUTCOMES).describe("What happened to the request."),
        redirected_to: z.string().optional().describe("Who it was redirected to (required if outcome is redirected)."),
        project: z.string().optional().describe("Related project name (fuzzy)."),
        received_on: ymd("Date received, YYYY-MM-DD. Default today (Hong Kong).").optional(),
      }),
      annotations: WR,
    },
    (a) =>
      safe(async () => {
        const p = a.project ? await resolveProjectRef(a.project) : null;
        return json(
          await logRequest({
            fromPerson: a.from_person,
            summary: a.summary,
            outcome: a.outcome,
            redirectedTo: a.redirected_to,
            project: p?.id ?? null,
            receivedOn: a.received_on,
          }),
        );
      }),
  );

  server.registerTool(
    "add_achievement",
    {
      title: "Add an achievement",
      description:
        "Record a result worth keeping for CV/reviews, ideally with numbers. Idempotent per title+day. Returns the saved record.",
      inputSchema: z.object({
        title: z.string().min(1),
        what_was_done: z.string().min(1),
        metric: z.string().optional().describe("Quantified result, e.g. 'load time -40%'."),
        cv_bullet: z.string().optional().describe("Optional ready-to-use CV bullet."),
        project: z.string().optional().describe("Related project name (fuzzy)."),
        achieved_on: ymd("Date, YYYY-MM-DD. Default today (Hong Kong).").optional(),
      }),
      annotations: WR,
    },
    (a) =>
      safe(async () => {
        const p = a.project ? await resolveProjectRef(a.project) : null;
        return json(
          await addAchievement({
            title: a.title,
            whatWasDone: a.what_was_done,
            metric: a.metric,
            cvBullet: a.cv_bullet,
            project: p?.id ?? null,
            achievedOn: a.achieved_on,
          }),
        );
      }),
  );

  server.registerTool(
    "export_weekly_sheet",
    {
      title: "Export the team Excel sheet block (.xlsx)",
      description:
        "Build the owner's block for the team's weekly Excel sheet: columns Owner, Requester, Initiative, Priority, Status, Progress this week, Total Progress, Next steps, Release date, Support needed / blocker, Last updated; a group row with the owner's full name; rows ordered P1 first then queue order. Returns a 10-minute download link. ALWAYS call with dry_run=true first and show the owner the rows and warnings; export only after they confirm. Missing fields are reported as warnings and left blank, never filled with placeholders.",
      inputSchema: z.object({
        week_start: weekStart,
        owner: z.string().optional().describe("Only projects whose owner short name matches, e.g. 'Hennes'. Default: all."),
        include_header: z.boolean().optional().describe("Include the header row. Default true."),
        include_group_row: z.boolean().optional().describe("Include the group row with the owner's full name. Default true."),
        dry_run: z.boolean().optional().describe("If true, only return the rows as a text table plus warnings; nothing is rendered."),
      }),
      annotations: WR,
    },
    (a) =>
      safe(async () =>
        json(
          await exportWeeklySheet(a.week_start, {
            owner: a.owner,
            includeHeader: a.include_header,
            includeGroupRow: a.include_group_row,
            dryRun: a.dry_run,
          }),
        ),
      ),
  );

  server.registerTool(
    "update_workspace_settings",
    {
      title: "Workspace settings (owner full name, Excel formats)",
      description:
        "Read or change workspace output settings. With no arguments it just returns the current settings. owner_full_name is the group-row text in the Excel export (e.g. 'Hennes Lam'). The date formats use {YYYY} {MM} {M} {DD} {D}, e.g. target '(Target Date: {M}/{D}/{YYYY})' and actual '{DD}/{MM}/{YYYY}'.",
      inputSchema: z.object({
        owner_full_name: z.string().optional(),
        sheet_name: z.string().optional().describe("Worksheet name in the exported .xlsx. Default 'Current'."),
        target_date_format: z.string().optional(),
        actual_date_format: z.string().optional(),
        last_updated_format: z.string().optional(),
      }),
      annotations: WR,
    },
    (a) =>
      safe(async () => {
        const sheet = {
          ...(a.sheet_name !== undefined ? { sheetName: a.sheet_name } : {}),
          ...(a.target_date_format !== undefined ? { targetDateFormat: a.target_date_format } : {}),
          ...(a.actual_date_format !== undefined ? { actualDateFormat: a.actual_date_format } : {}),
          ...(a.last_updated_format !== undefined ? { lastUpdatedFormat: a.last_updated_format } : {}),
        };
        const changing = a.owner_full_name !== undefined || Object.keys(sheet).length > 0;
        return json(
          changing
            ? await updateWorkspaceSettings({ ownerFullName: a.owner_full_name, sheet: Object.keys(sheet).length ? sheet : undefined })
            : await getWorkspaceSettings(),
        );
      }),
  );

  server.registerTool(
    "export_markdown",
    {
      title: "Export week as Markdown",
      description: "Plain-text/Markdown version of the week for email or Slack.",
      inputSchema: z.object({ week_start: weekStart }),
      annotations: RO,
    },
    ({ week_start }) => safe(async () => text(await exportMarkdown({ weekStart: week_start }))),
  );

  server.registerTool(
    "export_weekly_deck",
    {
      title: "Export weekly deck (.pptx)",
      description:
        "Render the weekly .pptx from the company template and return a 10-minute download link. Use dry_run first to show the planned slide text to the user before rendering.",
      inputSchema: z.object({
        week_start: weekStart,
        dry_run: z.boolean().optional().describe("If true, only return the planned slide text; nothing is rendered."),
      }),
      annotations: WR,
    },
    ({ week_start, dry_run }) =>
      safe(async () => json(await exportWeeklyDeck(week_start, { dryRun: dry_run }))),
  );

  server.registerTool(
    "export_cv_bullets",
    {
      title: "Export CV bullets",
      description: "Achievements as CV/LinkedIn bullet points, newest first. Uses the stored CV bullet when present.",
      inputSchema: z.object({
        since: ymd("Only achievements on/after this date, YYYY-MM-DD.").optional(),
      }),
      annotations: RO,
    },
    ({ since }) => safe(async () => text(cvBullets(await listAchievements({ from: since })))),
  );
}
