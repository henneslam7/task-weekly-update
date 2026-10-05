import { and, desc, eq, gte, lte } from "drizzle-orm";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";
import { todayLocal } from "../week";
import { findProject } from "./projects";

const { requestLog } = schema;

export type RequestEntry = typeof requestLog.$inferSelect;
export type Outcome = (typeof requestLog.outcome.enumValues)[number];
export const OUTCOMES = requestLog.outcome.enumValues;

export type LogRequestInput = {
  fromPerson: string;
  summary: string;
  outcome: Outcome;
  redirectedTo?: string | null;
  receivedOn?: string;
  project?: string | null;
  now?: Date;
};

/** Idempotent on (day, from, summary): logging again updates the outcome. */
export async function logRequest(input: LogRequestInput): Promise<RequestEntry> {
  const fromPerson = input.fromPerson?.trim();
  const summary = input.summary?.trim();
  if (!fromPerson || !summary) throw new Error("fromPerson and summary are required");
  if (input.outcome === "redirected" && !input.redirectedTo?.trim()) {
    throw new Error("redirectedTo is required when outcome is redirected");
  }
  const projectId = input.project ? (await findProject(input.project)).id : null;
  const receivedOn = input.receivedOn ?? todayLocal(input.now);
  const redirectedTo = input.outcome === "redirected" ? input.redirectedTo!.trim() : null;
  const [row] = await getDb()
    .insert(requestLog)
    .values({
      workspaceId: DEFAULT_WORKSPACE_ID,
      receivedOn,
      fromPerson,
      summary,
      outcome: input.outcome,
      redirectedTo,
      projectId,
    })
    .onConflictDoUpdate({
      target: [requestLog.workspaceId, requestLog.receivedOn, requestLog.fromPerson, requestLog.summary],
      set: { outcome: input.outcome, redirectedTo, projectId },
    })
    .returning();
  return row;
}

export async function listRequests(opts: { from?: string; to?: string } = {}): Promise<RequestEntry[]> {
  const conds = [eq(requestLog.workspaceId, DEFAULT_WORKSPACE_ID)];
  if (opts.from) conds.push(gte(requestLog.receivedOn, opts.from));
  if (opts.to) conds.push(lte(requestLog.receivedOn, opts.to));
  return getDb()
    .select()
    .from(requestLog)
    .where(and(...conds))
    .orderBy(desc(requestLog.receivedOn), desc(requestLog.createdAt));
}
