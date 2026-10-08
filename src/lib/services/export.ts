import { desc, eq, and } from "drizzle-orm";
import { BlobConfigError, DOWNLOAD_TTL_MS, PPTX_MIME, putPrivate, signDownloadUrl, assertBlobConfigured } from "../blob";
import { buildDeck, DeckError, type DeckPayload } from "../render";
import { DEFAULT_WORKSPACE_ID, getDb, schema } from "../db";
import { getWeekSummary, type WeekSummary } from "./summary";
import { isActive } from "./updates";
import { getWorkspaceSettings } from "./workspace";
import { DEFAULT_SHEET_CONFIG, formatIso, type SheetConfig } from "../sheet/config";

const { exportRun, file } = schema;

export { DOWNLOAD_TTL_MS, PPTX_MIME, signDownloadUrl };

/** A problem the user can fix (missing data etc.); message is safe to show. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/** Release date as shown in the team sheet: "(Target Date: M/D/YYYY)" for planned, dd/MM/yyyy for delivered, else the free-text note. */
function releaseText(p: { releaseDate: string | null; releaseDateType: "target" | "actual" | null; releaseDateNote: string | null }, cfg: SheetConfig): string | undefined {
  if (p.releaseDate) return formatIso(p.releaseDate, p.releaseDateType === "actual" ? cfg.actualDateFormat : cfg.targetDateFormat);
  return p.releaseDateNote?.trim() || undefined;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const dedupe = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Map the week data to the deck payload. Throws ExportError when there is nothing to export. */
export function summaryToPayload(s: WeekSummary, cfg: SheetConfig = DEFAULT_SHEET_CONFIG): { payload: DeckPayload; warnings: string[] } {
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
    const prog = u?.progress || u?.progressThisWeek;
    if (prog) progress.push(`${n}: ${clean(prog)}`);
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
        status_label: r.project.statusLabel ?? undefined,
        release: releaseText(r.project, cfg),
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
  const [summary, settings] = await Promise.all([getWeekSummary({ weekStart, now: opts.now }), getWorkspaceSettings()]);
  const { payload, warnings } = summaryToPayload(summary, settings.sheet);
  let built;
  try {
    built = await buildDeck(payload, { dryRun: opts.dryRun });
  } catch (e) {
    if (e instanceof DeckError) throw new ExportError(e.message);
    throw e;
  }
  if (opts.dryRun) {
    return { dryRun: true, weekStart: summary.weekStart, slideText: built.text, slides: built.slides.length, warnings };
  }

  const stored = await storeExport({
    format: "pptx",
    weekStart: summary.weekStart,
    ext: "pptx",
    buffer: built.buffer!,
    mime: PPTX_MIME,
    now: opts.now,
    warnings,
  });
  return { dryRun: false, weekStart: summary.weekStart, slideText: built.text, slides: built.slides.length, ...stored };
}

export type StoredExport = {
  warnings: string[];
  runId: string;
  fileId: string;
  downloadUrl?: string;
  expiresAt?: string;
  downloadPath: string;
};

/**
 * Upload a generated file to the PRIVATE Blob store, record file + export_run rows and return a 10-minute signed
 * link. Shared by the deck (.pptx) and sheet (.xlsx) exports. If only the signed link fails, the export still
 * succeeds and the authenticated `downloadPath` is returned with a warning.
 */
export async function storeExport(args: {
  format: "pptx" | "xlsx";
  weekStart: string;
  ext: string;
  buffer: Buffer;
  mime: string;
  now?: Date;
  warnings: string[];
  /** File name stem, e.g. "weekly-update" or "weekly-sheet". */
  stem?: string;
}): Promise<StoredExport> {
  try {
    assertBlobConfigured();
  } catch (e) {
    throw new ExportError((e as Error).message);
  }
  const stem = args.stem ?? (args.format === "xlsx" ? "weekly-sheet" : "weekly-update");
  const db = getDb();
  const [run] = await db
    .insert(exportRun)
    .values({ workspaceId: DEFAULT_WORKSPACE_ID, weekStart: args.weekStart, format: args.format, status: "pending" })
    .returning();
  try {
    const stamp = (args.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
    const blob = await putPrivate(`exports/${stem}-${args.weekStart}-${stamp}.${args.ext}`, args.buffer, args.mime);
    const [f] = await db
      .insert(file)
      .values({
        workspaceId: DEFAULT_WORKSPACE_ID,
        blobPathname: blob.pathname,
        kind: "export",
        originalName: `${stem}-${args.weekStart}.${args.ext}`,
        bytes: args.buffer.length,
        weekStart: args.weekStart,
      })
      .returning();
    await db.update(exportRun).set({ status: "done", fileId: f.id }).where(eq(exportRun.id, run.id));
    const common = { runId: run.id, fileId: f.id, downloadPath: `/api/export/download?run=${run.id}` };
    try {
      const { url, expiresAt } = await signDownloadUrl(blob.pathname);
      return { ...common, warnings: args.warnings, downloadUrl: url, expiresAt: new Date(expiresAt).toISOString() };
    } catch (e) {
      const why = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "unknown error";
      return {
        ...common,
        warnings: [...args.warnings, `Could not create a signed download link (${why}). Open the portal (login required) at ${common.downloadPath} to download.`],
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
  format: "pptx" | "xlsx";
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
      format: exportRun.format,
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
