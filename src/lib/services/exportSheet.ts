import { blockToText, buildSheetBlock, renderSheetXlsx, XLSX_MIME } from "../sheet";
import { ExportError, storeExport, type StoredExport } from "./export";
import { getWeekSummary } from "./summary";
import { getWorkspaceSettings } from "./workspace";

export type SheetExportResult = Partial<StoredExport> & {
  dryRun: boolean;
  weekStart: string;
  /** The rows as a plain-text table (always returned, so Claude can show them for confirmation). */
  text: string;
  rowCount: number;
  warnings: string[];
};

export type ExportSheetOptions = {
  /** Short owner name filter, e.g. "Hennes". Default: all projects. */
  owner?: string;
  includeHeader?: boolean;
  includeGroupRow?: boolean;
  dryRun?: boolean;
  now?: Date;
};

/** Export the week as the team's Excel block (.xlsx): header, group row, one row per initiative. */
export async function exportWeeklySheet(weekStart?: string, opts: ExportSheetOptions = {}): Promise<SheetExportResult> {
  const { includeHeader = true, includeGroupRow = true } = opts;
  const [summary, settings] = await Promise.all([getWeekSummary({ weekStart, now: opts.now }), getWorkspaceSettings()]);
  const block = buildSheetBlock(summary, {
    ownerFullName: settings.ownerFullName,
    owner: opts.owner,
    config: settings.sheet,
    timeZone: process.env.WEEK_TZ || "Asia/Hong_Kong",
  });
  const text = blockToText(block, { includeHeader, includeGroupRow });
  const base = { weekStart: block.weekStart, text, rowCount: block.rows.length, warnings: block.warnings };
  if (opts.dryRun) return { dryRun: true, ...base };

  if (!block.rows.length) throw new ExportError(`Nothing to export for the week of ${block.weekStart}: ${block.warnings.at(-1) ?? "no projects"}.`);
  if (includeGroupRow && !block.groupName) {
    throw new ExportError("The group row needs the owner's full name. Set it with update_workspace_settings (owner_full_name), or export with include_group_row=false.");
  }
  const buffer = await renderSheetXlsx(block, { includeHeader, includeGroupRow, config: settings.sheet });
  const stored = await storeExport({
    format: "xlsx",
    weekStart: block.weekStart,
    ext: "xlsx",
    buffer,
    mime: XLSX_MIME,
    now: opts.now,
    warnings: block.warnings,
  });
  return { dryRun: false, weekStart: block.weekStart, text, rowCount: block.rows.length, ...stored };
}
