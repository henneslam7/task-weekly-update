import { desc, eq, and } from "drizzle-orm";
import { BlobConfigError, DOWNLOAD_TTL_MS, PPTX_MIME, putPrivate, signDownloadUrl, assertBlobConfigured } from "../blob";
import { buildDeck, DeckError, type DeckPayload } from "../render";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";
import { getWeekSummary, type WeekSummary } from "./summary";
import { isActive } from "./updates";

const { exportRun, file } = schema;

export { DOWNLOAD_TTL_MS, PPTX_MIME, signDownloadUrl };

/** A problem the user can fix (missing data etc.); message is safe to show. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const dedupe = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Map the week data to the deck payload. Throws ExportError when there is nothing to export. */
export function summaryToPayload(s: WeekSummary): { payload: DeckPayload; warnings: string[] } {
  const withUpdate = s.projects.filter((r) => r.update);
  if (!s.projects.length) {
    throw new ExportError("No projects exist yet. Add projects and log weekly updates before exporting.");
  }
  if (!withUpdate.length) {
    throw new ExportError(
      `No weekly updates logged for the week of ${s.weekStart}. Log at least one project update before exporting.`,
    );
  }
  const wins: string[] = [];
  const progress: string[] = [];
  const blockers: string[] = [];
  const support: string[] = [];
  for (const r of s.projects) {
    const n = r.project.name;
    const u = r.update;
    if (u?.wins) wins.push(`${n}: ${clean(u.wins)}`);
    if (u?.progress) progress.push(`${n}: ${clean(u.progress)}`);
    if (u?.blockers) blockers.push(`${n}: ${clean(u.blockers)}`);
    for (const b of r.blockers) if (b.status !== "done") blockers.push(`${n}: ${clean(b.title)}`);
    if (u?.supportNeeded) support.push(`${n}: ${clean(u.supportNeeded)}`);
  }
  for (const a of s.achievements) wins.push(`${clean(a.title)}: ${clean(a.whatWasDone)}${a.metric ? ` (${clean(a.metric)})` : ""}`);

  const p1 = s.projects.filter((r) => r.project.priority === "P1" && isActive(r.project)).map((r) => r.project.name);
  const redirected = s.requests.filter((r) => r.outcome === "redirected").length;
  const focus = [
    p1.length ? `Focus: ${p1.join(", ")}.` : "",
    s.requests.length ? `${redirected} of ${s.requests.length} new requests redirected.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const payload: DeckPayload = {
    week_start: s.weekStart,
    focus_line: focus || undefined,
    wins: dedupe(wins),
    progress: dedupe(progress),
    blockers: dedupe(blockers),
    support_needed: dedupe(support),
    projects: s.projects.map((r) => {
      const u = r.update;
      const status = u?.rag ?? r.project.status;
      return {
        name: r.project.name,
        priority: r.project.priority,
        rag: status === "done" ? "green" : status,
        progress_pct: r.project.progressPct,
        next_steps: clean(u?.nextSteps) || undefined,
        blocker: clean(u?.blockers) || r.blockers.find((b) => b.status !== "done")?.title || undefined,
      };
    }),
  };
  const warnings = s.missing.map((p) => `No update logged this week for ${p.name}`);
  return { payload, warnings };
}

export type ExportResult = {
  dryRun: boolean;
  weekStart: string;
  slideText: string;
  slides: number;
  warnings: string[];
  runId?: string;
  fileId?: string;
  downloadUrl?: string;
  expiresAt?: string;
  /** Portal route (password login required) that always works while the file exists. */
  downloadPath?: string;
};

export async function exportWeeklyDeck(
  weekStart?: string,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<ExportResult> {
  const summary = await getWeekSummary({ weekStart, now: opts.now });
  const { payload, warnings } = summaryToPayload(summary);
  let built;
  try {
    built = await buildDeck(payload, { dryRun: opts.dryRun });
  } catch (e) {
    if (e instanceof DeckError) throw new ExportError(e.message);
    throw e;
  }
  const base = { weekStart: summary.weekStart, slideText: built.text, slides: built.slides.length, warnings };
  if (opts.dryRun) return { dryRun: true, ...base };

  try {
    assertBlobConfigured();
  } catch (e) {
    throw new ExportError((e as Error).message);
  }
  const db = getDb();
  const [run] = await db
    .insert(exportRun)
    .values({ workspaceId: DEFAULT_WORKSPACE_ID, weekStart: summary.weekStart, status: "pending" })
    .returning();
  try {
    const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
    const blob = await putPrivate(`exports/weekly-update-${summary.weekStart}-${stamp}.pptx`, built.buffer!);
    const [f] = await db
      .insert(file)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        blobPathname: blob.pathname,
        kind: "export",
        originalName: `weekly-update-${summary.weekStart}.pptx`,
        bytes: built.buffer!.length,
        weekStart: summary.weekStart,
      })
      .returning();
    await db.update(exportRun).set({ status: "done", fileId: f.id }).where(eq(exportRun.id, run.id));
    const common = { dryRun: false as const, ...base, runId: run.id, fileId: f.id, downloadPath: `/api/export/download?run=${run.id}` };
    try {
      const { url, expiresAt } = await signDownloadUrl(blob.pathname);
      return { ...common, downloadUrl: url, expiresAt: new Date(expiresAt).toISOString() };
    } catch (e) {
      // Upload succeeded; only the signed link failed. Keep the deck reachable through the authenticated route.
      const why = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "unknown error";
      return {
        ...common,
        warnings: [...warnings, `Could not create a signed download link (${why}). Open the portal (login required) at ${common.downloadPath} to download.`],
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(exportRun).set({ status: "failed", error: msg.slice(0, 1000) }).where(eq(exportRun.id, run.id));
    throw new ExportError(e instanceof BlobConfigError ? msg : `Export failed: ${msg}`);
  }
}

export type ExportRunRow = {
  id: string;
  weekStart: string;
  status: "pending" | "done" | "failed";
  error: string | null;
  createdAt: Date;
  fileId: string | null;
  bytes: number | null;
};

export async function listExportRuns(limit = 10): Promise<ExportRunRow[]> {
  const db = getDb();
  return db
    .select({
      id: exportRun.id,
      weekStart: exportRun.weekStart,
      status: exportRun.status,
      error: exportRun.error,
      createdAt: exportRun.createdAt,
      fileId: exportRun.fileId,
      bytes: file.bytes,
    })
    .from(exportRun)
    .leftJoin(file, eq(file.id, exportRun.fileId))
    .where(eq(exportRun.workspaceId, DEFAULT_WORKSPACE_ID))
    .orderBy(desc(exportRun.createdAt))
    .limit(limit);
}

/** Stored file of a finished export run. */
export async function getRunFile(runId: string): Promise<{ pathname: string; name: string }> {
  const db = getDb();
  const [row] = await db
    .select({ pathname: file.blobPathname, name: file.originalName })
    .from(exportRun)
    .innerJoin(file, eq(file.id, exportRun.fileId))
    .where(and(eq(exportRun.id, runId), eq(exportRun.workspaceId, DEFAULT_WORKSPACE_ID), eq(exportRun.status, "done")));
  if (!row) throw new ExportError("Export run not found or has no file.");
  return { pathname: row.pathname, name: row.name ?? "weekly-update.pptx" };
}

/** Fresh 10-minute URL for a past export run (so stale links never need to be stored). */
export async function getRunDownloadUrl(runId: string): Promise<string> {
  const { pathname } = await getRunFile(runId);
  try {
    return (await signDownloadUrl(pathname)).url;
  } catch (e) {
    throw e instanceof BlobConfigError ? new ExportError(e.message) : e;
  }
}
