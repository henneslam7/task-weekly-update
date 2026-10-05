// Tests run against a real in-memory Postgres (PGlite, WASM) with the committed
// drizzle migrations applied, so SQL, constraints and upserts are exercised.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDb, schema, type Db } from "../db";
import {
  addAchievement,
  exportMarkdown,
  getWeekSummary,
  listMissingUpdates,
  listProjects,
  logRequest,
  logWeeklyUpdate,
  upsertProject,
} from "./index";

let pg: PGlite;
const NOW = new Date("2026-10-07T10:00:00+08:00"); // Wed -> week 2026-10-05

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  setDb(db as unknown as Db);
});

beforeEach(async () => {
  await pg.exec(
    "TRUNCATE achievement, request_log, weekly_update, export_run, file, project RESTART IDENTITY CASCADE",
  );
});

describe("projects", () => {
  it("upserts idempotently by name and keeps omitted fields", async () => {
    const a = await upsertProject({ name: "ST sub-domain", priority: "P1", progressPct: 40 });
    const b = await upsertProject({ name: "ST sub-domain", status: "amber" });
    expect(b.id).toBe(a.id);
    expect(b.priority).toBe("P1");
    expect(b.progressPct).toBe(40);
    expect(b.status).toBe("amber");
    expect(await listProjects()).toHaveLength(1);
  });
  it("hides archived unless asked", async () => {
    await upsertProject({ name: "Old", archived: true });
    expect(await listProjects()).toHaveLength(0);
    expect(await listProjects({ includeArchived: true })).toHaveLength(1);
  });
  it("validates progress", async () => {
    await expect(upsertProject({ name: "x", progressPct: 101 })).rejects.toThrow();
  });
});

describe("weekly updates", () => {
  it("is idempotent per project+week and merges fields", async () => {
    await upsertProject({ name: "PPL Pass" });
    const a = await logWeeklyUpdate({ project: "ppl pass", progress: "Waiting on content", rag: "amber", now: NOW });
    const b = await logWeeklyUpdate({ project: "PPL Pass", wins: "Wireframes approved", now: NOW });
    expect(b.id).toBe(a.id);
    expect(b.weekStart).toBe("2026-10-05");
    expect(b.progress).toBe("Waiting on content");
    expect(b.wins).toBe("Wireframes approved");
    expect(b.rag).toBe("amber");
  });
  it("keeps separate weeks and rejects non-Monday week_start", async () => {
    await upsertProject({ name: "P" });
    const a = await logWeeklyUpdate({ project: "P", weekStart: "2026-09-28", progress: "a" });
    const b = await logWeeklyUpdate({ project: "P", weekStart: "2026-10-05", progress: "b" });
    expect(a.id).not.toBe(b.id);
    await expect(logWeeklyUpdate({ project: "P", weekStart: "2026-10-06" })).rejects.toThrow(/Monday/);
  });
  it("tasks/blockers need a title and upsert by title", async () => {
    await upsertProject({ name: "P" });
    await expect(logWeeklyUpdate({ project: "P", kind: "blocker", now: NOW })).rejects.toThrow(/title/);
    const a = await logWeeklyUpdate({ project: "P", kind: "blocker", title: "Dev env", status: "blocked", now: NOW });
    const b = await logWeeklyUpdate({ project: "P", kind: "blocker", title: "Dev env", status: "done", now: NOW });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe("done");
  });
  it("errors readably on unknown project", async () => {
    await upsertProject({ name: "Known" });
    await expect(logWeeklyUpdate({ project: "Nope", now: NOW })).rejects.toThrow(/Known/);
  });
  it("lists missing updates for active projects only", async () => {
    await upsertProject({ name: "A" });
    await upsertProject({ name: "B" });
    await upsertProject({ name: "Finished", status: "done" });
    await logWeeklyUpdate({ project: "A", progress: "x", now: NOW });
    const m = await listMissingUpdates({ now: NOW });
    expect(m.weekStart).toBe("2026-10-05");
    expect(m.projects.map((p) => p.name)).toEqual(["B"]);
  });
});

describe("requests and achievements", () => {
  it("logRequest is idempotent and requires a target when redirected", async () => {
    await expect(
      logRequest({ fromPerson: "Sam", summary: "Banner", outcome: "redirected", now: NOW }),
    ).rejects.toThrow(/redirectedTo/);
    const a = await logRequest({ fromPerson: "Sam", summary: "Banner", outcome: "accepted", now: NOW });
    const b = await logRequest({
      fromPerson: "Sam",
      summary: "Banner",
      outcome: "redirected",
      redirectedTo: "Nicholas",
      now: NOW,
    });
    expect(b.id).toBe(a.id);
    expect(b.outcome).toBe("redirected");
    expect(b.redirectedTo).toBe("Nicholas");
    expect(b.receivedOn).toBe("2026-10-07");
  });
  it("addAchievement is idempotent per title and day", async () => {
    const a = await addAchievement({ title: "Faster checkout", whatWasDone: "Redesigned", now: NOW });
    const b = await addAchievement({ title: "Faster checkout", whatWasDone: "Redesigned", metric: "+12% CVR", now: NOW });
    expect(b.id).toBe(a.id);
    expect(b.metric).toBe("+12% CVR");
  });
});

describe("week summary and markdown", () => {
  it("assembles the week and renders markdown", async () => {
    await upsertProject({ name: "ST sub-domain", priority: "P1", progressPct: 60 });
    await upsertProject({ name: "PPL Pass" });
    await logWeeklyUpdate({
      project: "ST sub-domain",
      wins: "Wireframes done",
      progress: "Hi-fi started",
      nextSteps: "Review",
      rag: "green",
      now: NOW,
    });
    await logRequest({ fromPerson: "Sam", summary: "Banner", outcome: "redirected", redirectedTo: "Nicholas", now: NOW });
    await addAchievement({ title: "Shipped wireframes", whatWasDone: "x", metric: "3 pages", now: NOW });

    const s = await getWeekSummary({ now: NOW });
    expect(s.weekStart).toBe("2026-10-05");
    expect(s.weekEnd).toBe("2026-10-11");
    expect(s.missing.map((p) => p.name)).toEqual(["PPL Pass"]);
    expect(s.requests).toHaveLength(1);

    const md = await exportMarkdown({ now: NOW });
    expect(md).toContain("# Weekly update: 2026-10-05 to 2026-10-11");
    expect(md).toContain("- ST sub-domain: Wireframes done");
    expect(md).toContain("redirected to Nicholas");
    expect(md).toContain("## Missing updates");
    expect(md).toContain("- PPL Pass");

    const other = await getWeekSummary({ weekStart: "2026-09-28" });
    expect(other.requests).toHaveLength(0);
  });
});
