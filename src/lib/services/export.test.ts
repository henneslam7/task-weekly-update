import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import JSZip from "jszip";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  put: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}));
vi.mock("@vercel/blob", () => blob);

import { setDb, schema, type Db } from "../db";
import {
  addAchievement,
  exportWeeklyDeck,
  ExportError,
  getRunDownloadUrl,
  listExportRuns,
  listProjects,
  logRequest,
  logWeeklyUpdate,
  upsertProject,
} from "./index";

let pg: PGlite;
const NOW = new Date("2026-10-07T10:00:00+08:00"); // week 2026-10-05

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  setDb(db as unknown as Db);
});

beforeEach(async () => {
  await pg.exec("TRUNCATE achievement, request_log, weekly_update, export_run, file, project RESTART IDENTITY CASCADE");
  vi.resetAllMocks();
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
  blob.put.mockImplementation(async (pathname: string) => ({ pathname: pathname.replace(".pptx", "-abc.pptx"), url: "x" }));
  blob.issueSignedToken.mockResolvedValue({ delegationToken: "d", clientSigningToken: "c", validUntil: 0 });
  blob.presignUrl.mockResolvedValue({ presignedUrl: "https://store.private.blob.vercel-storage.com/signed?sig=1" });
});

async function seed() {
  await upsertProject({ name: "ST sub-domain", priority: "P1", progressPct: 40 });
  await upsertProject({ name: "PPL Pass", priority: "P2", progressPct: 10 });
  await logWeeklyUpdate({ project: "ST sub-domain", wins: "Wireframes approved", progress: "Build started", nextSteps: "QA", rag: "amber", blockers: "Waiting on DNS", supportNeeded: "IT ticket", now: NOW });
  await logRequest({ fromPerson: "Ann", summary: "New banner", outcome: "redirected", redirectedTo: "Design", receivedOn: "2026-10-06" });
  await addAchievement({ title: "Launched pass", whatWasDone: "Shipped v1", metric: "+5%", achievedOn: "2026-10-06" });
}

describe("exportWeeklyDeck", () => {
  it("fails readably when there are no projects or updates", async () => {
    await expect(exportWeeklyDeck(undefined, { dryRun: true, now: NOW })).rejects.toThrow(/No projects exist/);
    await upsertProject({ name: "Only" });
    await expect(exportWeeklyDeck("2026-10-05", { dryRun: true })).rejects.toThrow(/No weekly updates logged for the week of 2026-10-05/);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("rejects a non-Monday week", async () => {
    await expect(exportWeeklyDeck("2026-10-06", { dryRun: true })).rejects.toThrow(/Monday/);
  });

  it("dry run returns slide text, writes nothing", async () => {
    await seed();
    const r = await exportWeeklyDeck("2026-10-05", { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.slideText).toContain("Week of 5 Oct 2026");
    expect(r.slideText).toContain("Focus: ST sub-domain.");
    expect(r.slideText).toContain("1 of 1 new requests redirected");
    expect(r.slideText).toContain("ST sub-domain: Wireframes approved");
    expect(r.slideText).toContain("Launched pass: Shipped v1 (+5%)");
    expect(r.warnings).toEqual(["No update logged this week for PPL Pass"]);
    expect(blob.put).not.toHaveBeenCalled();
    expect(await listExportRuns()).toHaveLength(0);
  });

  it("builds, uploads privately, records the run and returns a 10 minute presigned URL", async () => {
    await seed();
    const r = await exportWeeklyDeck("2026-10-05", { now: NOW });
    expect(blob.put).toHaveBeenCalledTimes(1);
    const [path, body, opts] = blob.put.mock.calls[0];
    expect(path).toMatch(/^exports\/weekly-update-2026-10-05-.*\.pptx$/);
    expect(opts).toMatchObject({ access: "private", addRandomSuffix: true });
    const zip = await JSZip.loadAsync(body as Buffer);
    expect(Object.keys(zip.files).some((n) => n.startsWith("ppt/slides/slide"))).toBe(true);

    const sign = blob.issueSignedToken.mock.calls[0][0];
    expect(sign.operations).toEqual(["get"]);
    expect(sign.validUntil - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(sign.validUntil - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect(blob.presignUrl.mock.calls[0][1]).toMatchObject({ operation: "get", access: "private" });
    expect(r.downloadUrl).toContain("signed");

    const runs = await listExportRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "done", weekStart: "2026-10-05" });
    expect(runs[0].bytes).toBeGreaterThan(1000);
    expect(await getRunDownloadUrl(runs[0].id)).toContain("signed");
    expect((await listProjects()).length).toBe(2);
  });

  it("records a failed run when the upload fails", async () => {
    await seed();
    blob.put.mockRejectedValue(new Error("store suspended"));
    await expect(exportWeeklyDeck("2026-10-05")).rejects.toThrow(/Export failed: store suspended/);
    const runs = await listExportRuns();
    expect(runs[0]).toMatchObject({ status: "failed", error: "store suspended", fileId: null });
    await expect(getRunDownloadUrl(runs[0].id)).rejects.toBeInstanceOf(ExportError);
  });

  it("explains missing Blob configuration before touching the db", async () => {
    await seed();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL_OIDC_TOKEN;
    await expect(exportWeeklyDeck("2026-10-05")).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
    expect(await listExportRuns()).toHaveLength(0);
  });
});
