import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const priorityEnum = pgEnum("priority", ["P1", "P2", "P3"]);
export const projectStatusEnum = pgEnum("project_status", ["green", "amber", "red", "done"]);
export const ragEnum = pgEnum("rag", ["green", "amber", "red"]);
export const updateKindEnum = pgEnum("update_kind", ["progress", "task", "blocker"]);
export const updateStatusEnum = pgEnum("update_status", ["open", "done", "blocked"]);
export const outcomeEnum = pgEnum("request_outcome", ["accepted", "redirected", "declined"]);
export const fileKindEnum = pgEnum("file_kind", ["template", "export"]);
export const exportStatusEnum = pgEnum("export_status", ["pending", "done", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const workspaceId = () => uuid("workspace_id").notNull().references(() => workspace.id);

export const workspace = pgTable("workspace", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    description: text("description"),
    priority: priorityEnum("priority").notNull().default("P2"),
    status: projectStatusEnum("status").notNull().default("green"),
    progressPct: integer("progress_pct").notNull().default(0),
    dueDate: date("due_date"),
    requester: text("requester"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("project_ws_name_uq").on(t.workspaceId, t.name)],
);

export const weeklyUpdate = pgTable(
  "weekly_update",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    projectId: uuid("project_id").notNull().references(() => project.id),
    weekStart: date("week_start").notNull(),
    kind: updateKindEnum("kind").notNull().default("progress"),
    title: text("title"),
    wins: text("wins"),
    progress: text("progress"),
    nextSteps: text("next_steps"),
    blockers: text("blockers"),
    supportNeeded: text("support_needed"),
    rag: ragEnum("rag"),
    status: updateStatusEnum("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One progress update per project per week; idempotent upsert target.
    uniqueIndex("weekly_update_progress_uq")
      .on(t.workspaceId, t.projectId, t.weekStart)
      .where(sql`${t.kind} = 'progress'`),
    // Tasks/blockers are keyed by title within a project and week.
    uniqueIndex("weekly_update_item_uq")
      .on(t.workspaceId, t.projectId, t.weekStart, t.kind, t.title)
      .where(sql`${t.kind} <> 'progress'`),
    index("weekly_update_week_idx").on(t.workspaceId, t.weekStart),
  ],
);

export const requestLog = pgTable(
  "request_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    receivedOn: date("received_on").notNull(),
    fromPerson: text("from_person").notNull(),
    summary: text("summary").notNull(),
    outcome: outcomeEnum("outcome").notNull(),
    redirectedTo: text("redirected_to"),
    projectId: uuid("project_id").references(() => project.id),
    createdAt: createdAt(),
  },
  (t) => [
    // Idempotency: the same request logged twice on a day is one row.
    uniqueIndex("request_log_dedupe_uq").on(t.workspaceId, t.receivedOn, t.fromPerson, t.summary),
  ],
);

export const achievement = pgTable(
  "achievement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    projectId: uuid("project_id").references(() => project.id),
    title: text("title").notNull(),
    whatWasDone: text("what_was_done").notNull(),
    metric: text("metric"),
    period: text("period"),
    achievedOn: date("achieved_on").notNull(),
    cvBullet: text("cv_bullet"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("achievement_ws_title_day_uq").on(t.workspaceId, t.title, t.achievedOn)],
);

export const file = pgTable("file", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: workspaceId(),
  blobPathname: text("blob_pathname").notNull(),
  kind: fileKindEnum("kind").notNull(),
  originalName: text("original_name"),
  bytes: integer("bytes"),
  weekStart: date("week_start"),
  createdAt: createdAt(),
});

export const exportRun = pgTable("export_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: workspaceId(),
  weekStart: date("week_start").notNull(),
  fileId: uuid("file_id").references(() => file.id),
  status: exportStatusEnum("status").notNull().default("pending"),
  error: text("error"),
  createdAt: createdAt(),
});
