import { and, asc, eq, sql } from "drizzle-orm";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";

const { project } = schema;

export type Project = typeof project.$inferSelect;
export type Priority = (typeof project.priority.enumValues)[number];
export type ProjectStatus = (typeof project.status.enumValues)[number];

export type StatusLabel = (typeof project.statusLabel.enumValues)[number];
export type ReleaseDateType = (typeof project.releaseDateType.enumValues)[number];

export const PRIORITIES = project.priority.enumValues;
export const PROJECT_STATUSES = project.status.enumValues;
export const STATUS_LABELS = project.statusLabel.enumValues;
export const RELEASE_DATE_TYPES = project.releaseDateType.enumValues;

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
  /** Short owner name for the Excel Owner column (e.g. "Hennes"). */
  ownerShortName?: string | null;
  /** Team-sheet Status. Set explicitly; never derived from RAG. */
  statusLabel?: StatusLabel | null;
  /** ISO date YYYY-MM-DD. */
  releaseDate?: string | null;
  releaseDateType?: ReleaseDateType | null;
  /** Free text used when there is no date (e.g. "TBA", "within Nov"). */
  releaseDateNote?: string | null;
  queueOrder?: number | null;
  archived?: boolean;
  /** Rename the existing project called `name` (fails if it does not exist or the new name is taken). */
  newName?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function assertIsoDate(label: string, v: string | null | undefined) {
  if (v === undefined || v === null) return;
  const d = new Date(v + "T00:00:00Z");
  if (!ISO_DATE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new Error(`${label} must be a real date as YYYY-MM-DD (got "${v}")`);
  }
}

/** Create or update by name. Omitted fields are left untouched on update. */
export async function upsertProject(input: UpsertProjectInput): Promise<Project> {
  const name = input.name?.trim();
  if (!name) throw new Error("Project name is required");
  if (input.progressPct !== undefined && (input.progressPct < 0 || input.progressPct > 100)) {
    throw new Error("progressPct must be between 0 and 100");
  }
  assertIsoDate("dueDate", input.dueDate);
  assertIsoDate("releaseDate", input.releaseDate);
  if (input.queueOrder !== undefined && input.queueOrder !== null && !Number.isInteger(input.queueOrder)) {
    throw new Error("queueOrder must be an integer");
  }
  const db0 = getDb();
  let targetName = name;
  if (input.newName !== undefined) {
    const newName = input.newName.trim();
    if (!newName) throw new Error("newName must not be empty");
    if (newName !== name) {
      const existing = await findProject(name);
      const clash = await db0
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.workspaceId, DEFAULT_WORKSPACE_ID), sql`lower(${project.name}) = lower(${newName})`));
      if (clash.some((c) => c.id !== existing.id)) throw new Error(`A project called "${newName}" already exists`);
      await db0.update(project).set({ name: newName, updatedAt: sql`now()` }).where(eq(project.id, existing.id));
      targetName = newName;
    }
  }
  const values = {
    description: input.description,
    priority: input.priority,
    status: input.status,
    progressPct: input.progressPct,
    dueDate: input.dueDate,
    requester: input.requester,
    ownerShortName: input.ownerShortName,
    statusLabel: input.statusLabel,
    releaseDate: input.releaseDate,
    releaseDateType: input.releaseDateType,
    releaseDateNote: input.releaseDateNote,
    queueOrder: input.queueOrder,
    archived: input.archived,
  };
  const defined = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const db = getDb();
  const [row] = await db
    .insert(project)
    .values({ workspaceId: DEFAULT_WORKSPACE_ID, name: targetName, ...defined })
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
