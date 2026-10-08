import { and, eq, sql } from "drizzle-orm";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";
import { resolveWeekStart } from "../week";
import { findProject, listProjects, type Project } from "./projects";

const { weeklyUpdate } = schema;

export type WeeklyUpdate = typeof weeklyUpdate.$inferSelect;
export type Rag = (typeof weeklyUpdate.rag.enumValues)[number];
export type UpdateKind = (typeof weeklyUpdate.kind.enumValues)[number];
export type UpdateStatus = (typeof weeklyUpdate.status.enumValues)[number];

export const RAGS = weeklyUpdate.rag.enumValues;

export type LogWeeklyUpdateInput = {
  /** Project name (case-insensitive) or id. */
  project: string;
  /** Must be a Monday. Defaults to the current week per the week rule. */
  weekStart?: string;
  kind?: UpdateKind;
  /** Required for kind task/blocker. */
  title?: string;
  wins?: string | null;
  progress?: string | null;
  /** Excel "Progress this week" free text. */
  progressThisWeek?: string | null;
  nextSteps?: string | null;
  blockers?: string | null;
  supportNeeded?: string | null;
  rag?: Rag | null;
  status?: UpdateStatus;
  now?: Date;
};

/**
 * Idempotent upsert: one progress update per project+week; tasks/blockers are
 * keyed by title. Omitted fields keep their stored value. Returns the row.
 */
export async function logWeeklyUpdate(input: LogWeeklyUpdateInput): Promise<WeeklyUpdate> {
  const proj = await findProject(input.project);
  const weekStart = resolveWeekStart(input.weekStart, input.now);
  const kind = input.kind ?? "progress";
  const title = input.title?.trim() || null;
  if (kind !== "progress" && !title) throw new Error(`title is required for kind "${kind}"`);

  const values = {
    wins: input.wins,
    progress: input.progress,
    progressThisWeek: input.progressThisWeek,
    nextSteps: input.nextSteps,
    blockers: input.blockers,
    supportNeeded: input.supportNeeded,
    rag: input.rag,
    status: input.status,
  };
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const db = getDb();
  const base = {
    workspaceId: DEFAULT_WORKSPACE_ID,
    projectId: proj.id,
    weekStart,
    kind,
    title: kind === "progress" ? null : title,
    ...defined,
  };
  const set = { ...defined, updatedAt: sql`now()` };
  const [row] =
    kind === "progress"
      ? await db
          .insert(weeklyUpdate)
          .values(base)
          .onConflictDoUpdate({
            target: [weeklyUpdate.workspaceId, weeklyUpdate.projectId, weeklyUpdate.weekStart],
            targetWhere: sql`${weeklyUpdate.kind} = 'progress'`,
            set,
          })
          .returning()
      : await db
          .insert(weeklyUpdate)
          .values(base)
          .onConflictDoUpdate({
            target: [
              weeklyUpdate.workspaceId,
              weeklyUpdate.projectId,
              weeklyUpdate.weekStart,
              weeklyUpdate.kind,
              weeklyUpdate.title,
            ],
            targetWhere: sql`${weeklyUpdate.kind} <> 'progress'`,
            set,
          })
          .returning();
  return row;
}

export async function listUpdatesForWeek(weekStart: string): Promise<WeeklyUpdate[]> {
  return getDb()
    .select()
    .from(weeklyUpdate)
    .where(and(eq(weeklyUpdate.workspaceId, DEFAULT_WORKSPACE_ID), eq(weeklyUpdate.weekStart, weekStart)));
}

export function isActive(p: Project): boolean {
  return !p.archived && p.status !== "done";
}

/** Active projects with no progress update for the week. */
export async function listMissingUpdates(opts: { weekStart?: string; now?: Date } = {}): Promise<{
  weekStart: string;
  projects: Project[];
}> {
  const weekStart = resolveWeekStart(opts.weekStart, opts.now);
  const [projects, updates] = await Promise.all([listProjects(), listUpdatesForWeek(weekStart)]);
  const have = new Set(updates.filter((u) => u.kind === "progress").map((u) => u.projectId));
  return { weekStart, projects: projects.filter((p) => isActive(p) && !have.has(p.id)) };
}
