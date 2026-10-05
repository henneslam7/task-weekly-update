import { and, asc, eq, sql } from "drizzle-orm";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";

const { project } = schema;

export type Project = typeof project.$inferSelect;
export type Priority = (typeof project.priority.enumValues)[number];
export type ProjectStatus = (typeof project.status.enumValues)[number];

export const PRIORITIES = project.priority.enumValues;
export const PROJECT_STATUSES = project.status.enumValues;

export async function listProjects(opts: { includeArchived?: boolean } = {}): Promise<Project[]> {
  const db = getDb();
  const where = opts.includeArchived
    ? eq(project.workspaceId, DEFAULT_WORKSPACE_ID)
    : and(eq(project.workspaceId, DEFAULT_WORKSPACE_ID), eq(project.archived, false));
  return db.select().from(project).where(where).orderBy(asc(project.priority), asc(project.name));
}

export type UpsertProjectInput = {
  name: string;
  description?: string | null;
  priority?: Priority;
  status?: ProjectStatus;
  progressPct?: number;
  dueDate?: string | null;
  requester?: string | null;
  archived?: boolean;
};

/** Create or update by name. Omitted fields are left untouched on update. */
export async function upsertProject(input: UpsertProjectInput): Promise<Project> {
  const name = input.name?.trim();
  if (!name) throw new Error("Project name is required");
  if (input.progressPct !== undefined && (input.progressPct < 0 || input.progressPct > 100)) {
    throw new Error("progressPct must be between 0 and 100");
  }
  const values = {
    description: input.description,
    priority: input.priority,
    status: input.status,
    progressPct: input.progressPct,
    dueDate: input.dueDate,
    requester: input.requester,
    archived: input.archived,
  };
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const db = getDb();
  const [row] = await db
    .insert(project)
    .values({ workspaceId: DEFAULT_WORKSPACE_ID, name, ...defined })
    .onConflictDoUpdate({
      target: [project.workspaceId, project.name],
      set: { ...defined, updatedAt: sql`now()` },
    })
    .returning();
  return row;
}

/** Resolve a project by uuid or case-insensitive name. */
export async function findProject(ref: string): Promise<Project> {
  const db = getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const rows = await db
    .select()
    .from(project)
    .where(
      and(
        eq(project.workspaceId, DEFAULT_WORKSPACE_ID),
        isUuid ? eq(project.id, ref) : sql`lower(${project.name}) = lower(${ref.trim()})`,
      ),
    );
  if (!rows[0]) {
    const all = await listProjects({ includeArchived: true });
    throw new Error(
      `Project "${ref}" not found. Known projects: ${all.map((p) => p.name).join(", ") || "(none)"}`,
    );
  }
  return rows[0];
}
