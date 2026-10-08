import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({ put: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/blob", () => blob);

import { setDb, schema, type Db } from "../db";
import { EXPECTED_CELLS, FIXTURE, FIXTURE_OWNER_FULL, FIXTURE_OWNER_SHORT, FIXTURE_WEEK } from "../sheet/fixture.hennes";
import {
  ExportError,
  exportWeeklyDeck,
  exportWeeklySheet,
  getWeekSummary,
  getWorkspaceSettings,
  listExportRuns,
  logWeeklyUpdate,
  updateWorkspaceSettings,
  upsertProject,
} from "./index";

let pg: PGlite;
const NOW = new Date("2026-10-08T10:00:00+08:00"); // Thursday of week 2026-10-05

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  setDb(db as unknown as Db);
});

beforeEach(async () => {
  await pg.exec("TRUNCATE achievement, request_log, weekly_update, export_run, file, project RESTART IDENTITY CASCADE");
  await pg.exec("UPDATE workspace SET owner_full_name = NULL, brand_config = '{}'::jsonb");
  vi.resetAllMocks();
  for (const k of ["BLOB_STORE_ID", "VERCEL_OIDC_TOKEN", "VERCEL"]) delete process.env[k];
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  blob.put.mockImplementation(async (pathname: string) => ({ pathname: pathname.replace(".xlsx", "-abc.xlsx"), url: "x" }));
  blob.issueSignedToken.mockResolvedValue({});
  blob.presignUrl.mockResolvedValue({ presignedUrl: "https://store.private.blob.vercel-storage.com/signed?sig=1" });
});

/** Load the fixture through the real services (what the MCP tools do). */
async function loadFixture() {
  await updateWorkspaceSettings({ ownerFullName: FIXTURE_OWNER_FULL });
  for (const f of FIXTURE) {
    await upsertProject({
      name: f.initiative,
      priority: f.priority,
      requester: f.requester,
      progressPct: f.progressPct,
      ownerShortName: FIXTURE_OWNER_SHORT,
      statusLabel: f.statusLabel,
      releaseDate: f.release && "date" in f.release ? f.release.date : undefined,
      releaseDateType: f.release && "date" in f.release ? f.release.type : undefined,
      queueOrder: f.queueOrder,
    });
    await logWeeklyUpdate({
      project: f.initiative,
      weekStart: FIXTURE_WEEK,
      progressThisWeek: f.progressThisWeek,
      nextSteps: f.nextSteps,
      blockers: f.blocker || undefined,
      supportNeeded: f.supportNeeded || undefined,
      rag: "amber",
    });
  }
  // updated_at is "now()" in the database; pin it to the sheet's Last updated date.
  await pg.exec("UPDATE weekly_update SET updated_at = '2026-10-05T10:00:00+08:00'");
}

describe("exportWeeklySheet (database + services)", () => {
  it("dry run reproduces the fixture table and warns about nothing", async () => {
    await loadFixture();
    const r = await exportWeeklySheet(undefined, { dryRun: true, now: NOW }); // Thursday -> this week's Monday
    expect(r.dryRun).toBe(true);
    expect(r.weekStart).toBe(FIXTURE_WEEK);
    expect(r.rowCount).toBe(7);
    expect(r.warnings).toEqual([]);
    expect(r.text).toContain("| Hennes Lam |");
    for (const row of EXPECTED_CELLS) expect(r.text).toContain("| " + row.map((c) => c.replace(/\n/g, " ⏎ ")).join(" | ") + " |");
    expect(blob.put).not.toHaveBeenCalled();
    expect(await listExportRuns()).toHaveLength(0);
  });

  it("renders the .xlsx, uploads it privately, records an xlsx run and returns a 10-minute link", async () => {
    await loadFixture();
    const r = await exportWeeklySheet(FIXTURE_WEEK, { now: NOW });
    expect(blob.put).toHaveBeenCalledTimes(1);
    const [path, body, opts] = blob.put.mock.calls[0];
    expect(path).toMatch(/^exports\/weekly-sheet-2026-10-05-.*\.xlsx$/);
    expect(opts).toMatchObject({ access: "private", contentType: expect.stringContaining("spreadsheetml.sheet") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).values).toEqual([undefined, "Owner", "Requester", "Initiative", "Priority", "Status", "Progress this week", "Total Progress", "Next steps", "Release date", "Support needed / blocker", "Last updated"]);
    expect(ws.getCell("A2").value).toBe("Hennes Lam");
    expect(ws.getCell("C3").value).toBe("PPL One Pager Fast Checkout flow");
    expect(ws.getCell("I3").value).toBe("(Target Date: 11/1/2026)");
    expect(r.downloadUrl).toContain("signed");
    expect(r.downloadPath).toBe(`/api/export/download?run=${r.runId}`);
    const runs = await listExportRuns();
    expect(runs[0]).toMatchObject({ status: "done", format: "xlsx" });
  });

  it("fails readably: no group-row name, nothing to export, missing Blob config", async () => {
    await loadFixture();
    await updateWorkspaceSettings({ ownerFullName: "" });
    await expect(exportWeeklySheet(FIXTURE_WEEK)).rejects.toThrow(/owner's full name[\s\S]*update_workspace_settings/);
    expect((await exportWeeklySheet(FIXTURE_WEEK, { dryRun: true })).warnings[0]).toMatch(/full name is not set/);
    await expect(exportWeeklySheet(FIXTURE_WEEK, { owner: "nobody" })).rejects.toBeInstanceOf(ExportError);
    await updateWorkspaceSettings({ ownerFullName: FIXTURE_OWNER_FULL });
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await expect(exportWeeklySheet(FIXTURE_WEEK)).rejects.toThrow(/Blob is not configured/);
    expect(await listExportRuns()).toHaveLength(0);
  });

  it("header/group-row switches and the owner filter reach the file", async () => {
    await loadFixture();
    await upsertProject({ name: "Someone else's thing", ownerShortName: "Nicholas", priority: "P3" });
    const r = await exportWeeklySheet(FIXTURE_WEEK, { dryRun: true, owner: "Hennes", includeHeader: false, includeGroupRow: false });
    expect(r.rowCount).toBe(7);
    expect(r.text).not.toContain("Initiative");
    expect(r.text).not.toContain("Someone else");
  });

  it("uses date formats from workspace settings", async () => {
    await loadFixture();
    await updateWorkspaceSettings({ sheet: { targetDateFormat: "(Target: {D}/{M}/{YYYY})", sheetName: "Hennes" } });
    const r = await exportWeeklySheet(FIXTURE_WEEK, { dryRun: true });
    expect(r.text).toContain("(Target: 1/11/2026)");
    await expect(updateWorkspaceSettings({ sheet: { actualDateFormat: "{Q}" } })).rejects.toThrow(/unknown placeholder/);
    expect((await getWorkspaceSettings()).sheet.sheetName).toBe("Hennes");
  });
});

describe("project/update fields and backward compatibility", () => {
  it("upsert_project accepts the new fields, keeps untouched ones, validates dates, and can rename", async () => {
    await upsertProject({ name: "PPL Pass", priority: "P1", requester: "Sajin", progressPct: 5 });
    const p = await upsertProject({ name: "PPL Pass", statusLabel: "Blocked", releaseDate: "2026-10-30", releaseDateType: "target", queueOrder: 2, ownerShortName: "Hennes", releaseDateNote: "TBA" });
    expect(p).toMatchObject({ priority: "P1", requester: "Sajin", progressPct: 5, statusLabel: "Blocked", releaseDate: "2026-10-30", releaseDateType: "target", queueOrder: 2, ownerShortName: "Hennes", releaseDateNote: "TBA" });
    await expect(upsertProject({ name: "PPL Pass", releaseDate: "2026-02-30" })).rejects.toThrow(/real date/);
    const renamed = await upsertProject({ name: "PPL Pass", newName: "PPL Pass (Pass Gifting)" });
    expect(renamed).toMatchObject({ id: p.id, name: "PPL Pass (Pass Gifting)", statusLabel: "Blocked" });
    await upsertProject({ name: "Other" });
    await expect(upsertProject({ name: "Other", newName: "ppl pass (pass gifting)" })).rejects.toThrow(/already exists/);
    expect((await upsertProject({ name: "PPL Pass (Pass Gifting)", releaseDate: null, releaseDateType: null })).releaseDate).toBeNull();
  });

  it("old inputs still work: no new fields, old log_weekly_update fields, deck export unchanged", async () => {
    await upsertProject({ name: "ST sub-domain", priority: "P1", progressPct: 40 });
    const u = await logWeeklyUpdate({ project: "ST sub-domain", weekStart: FIXTURE_WEEK, wins: "Wireframes approved", progress: "Build started", nextSteps: "QA", rag: "amber", blockers: "Waiting on DNS", supportNeeded: "IT ticket" });
    expect(u).toMatchObject({ progress: "Build started", progressThisWeek: null });
    const sum = await getWeekSummary({ weekStart: FIXTURE_WEEK });
    expect(sum.projects[0].project).toMatchObject({ statusLabel: null, releaseDate: null, ownerShortName: null });
    const deck = await exportWeeklyDeck(FIXTURE_WEEK, { dryRun: true });
    expect(deck.slideText).toContain("ST sub-domain: Build started");
    // Sheet export of old-style data: warns, falls back to the old progress text, blanks the rest.
    const sheet = await exportWeeklySheet(FIXTURE_WEEK, { dryRun: true });
    expect(sheet.warnings.join("\n")).toMatch(/no Status set/);
    expect(sheet.warnings.join("\n")).toMatch(/older "progress" text/);
    expect(sheet.text).toContain("Build started");
  });

  it("deck status table shows Status label and Release date", async () => {
    await loadFixture();
    const deck = await exportWeeklyDeck(FIXTURE_WEEK, { dryRun: true });
    expect(deck.slideText).toMatch(/\| PPL Pass \(Pass Gifting\) \| P1 \| AMBER \| Blocked \| 10% \| \(Target Date: 10\/30\/2026\) \|/);
    expect(deck.slideText).toMatch(/\| ST sub-domain \| P1 \| AMBER \| On track \| 90% \| 06\/10\/2026 \|/);
  });
});

describe("migration 0001 is reversible and keeps weekly updates", () => {
  it("rolling back drops only the new columns; existing updates survive", async () => {
    const p2 = new PGlite();
    const db = drizzle(p2, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await p2.exec(`INSERT INTO project (workspace_id, name) SELECT id, 'Keep me' FROM workspace LIMIT 1;
      INSERT INTO weekly_update (workspace_id, project_id, week_start, progress, next_steps)
        SELECT w.id, p.id, '2026-10-05', 'Old progress', 'Old next' FROM workspace w, project p LIMIT 1;`);
    await p2.exec(readFileSync("./drizzle/rollback/0001_excel_sheet_fields.down.sql", "utf8").replace(/^--.*$/gm, ""));
    const cols = await p2.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('project','weekly_update','workspace','export_run')",
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const gone of ["status_label", "release_date", "release_date_type", "release_date_note", "queue_order", "owner_short_name", "progress_this_week", "owner_full_name", "brand_config", "format"]) {
      expect(names).not.toContain(gone);
    }
    const kept = await p2.query<{ progress: string; next_steps: string }>("SELECT progress, next_steps FROM weekly_update");
    expect(kept.rows).toEqual([{ progress: "Old progress", next_steps: "Old next" }]);
    expect((await p2.query("SELECT count(*)::int AS n FROM project")).rows[0]).toEqual({ n: 1 });
  });
});
