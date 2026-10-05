import { and, desc, eq, gte, lte } from "drizzle-orm";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";
import { todayLocal } from "../week";
import { findProject } from "./projects";

const { achievement } = schema;

export type Achievement = typeof achievement.$inferSelect;

export type AddAchievementInput = {
  title: string;
  whatWasDone: string;
  metric?: string | null;
  period?: string | null;
  cvBullet?: string | null;
  project?: string | null;
  achievedOn?: string;
  now?: Date;
};

/** Idempotent on (title, day): re-adding updates the existing record. */
export async function addAchievement(input: AddAchievementInput): Promise<Achievement> {
  const title = input.title?.trim();
  const whatWasDone = input.whatWasDone?.trim();
  if (!title || !whatWasDone) throw new Error("title and whatWasDone are required");
  const projectId = input.project ? (await findProject(input.project)).id : undefined;
  const achievedOn = input.achievedOn ?? todayLocal(input.now);
  const defined = Object.fromEntries(
    Object.entries({
      whatWasDone,
      metric: input.metric,
      period: input.period,
      cvBullet: input.cvBullet,
      projectId,
    }).filter(([, v]) => v !== undefined),
  );
  const [row] = await getDb()
    .insert(achievement)
    .values({ workspaceId: DEFAULT_WORKSPACE_ID, title, achievedOn, ...defined, whatWasDone })
    .onConflictDoUpdate({
      target: [achievement.workspaceId, achievement.title, achievement.achievedOn],
      set: defined,
    })
    .returning();
  return row;
}

export async function listAchievements(opts: { from?: string; to?: string } = {}): Promise<Achievement[]> {
  const conds = [eq(achievement.workspaceId, DEFAULT_WORKSPACE_ID)];
  if (opts.from) conds.push(gte(achievement.achievedOn, opts.from));
  if (opts.to) conds.push(lte(achievement.achievedOn, opts.to));
  return getDb()
    .select()
    .from(achievement)
    .where(and(...conds))
    .orderBy(desc(achievement.achievedOn), desc(achievement.createdAt));
}
