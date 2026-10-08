// Pure mapping: week summary -> the team Excel block (group row + rows). No I/O, so it is easy to test.
import type { WeekSummary } from "../services/summary";
import { DEFAULT_SHEET_CONFIG, formatIso, isoDateInTz, type SheetConfig } from "./config";

export const SHEET_HEADERS = [
  "Owner",
  "Requester",
  "Initiative",
  "Priority",
  "Status",
  "Progress this week",
  "Total Progress",
  "Next steps",
  "Release date",
  "Support needed / blocker",
  "Last updated",
] as const;

/** Release date cell: a real date (delivered), text (planned or free text), or empty. */
export type ReleaseCell =
  | { kind: "date"; iso: string; display: string }
  | { kind: "text"; text: string }
  | { kind: "empty" };

export type SheetRow = {
  owner: string;
  requester: string;
  initiative: string;
  priority: string;
  status: string;
  progressThisWeek: string;
  /** 0..1, written as a number with a 0% format (like the team sheet) so it displays "N%". */
  totalProgress: number;
  nextSteps: string;
  release: ReleaseCell;
  support: string;
  /** ISO date or null. */
  lastUpdated: string | null;
  lastUpdatedDisplay: string;
};

export type SheetBlock = {
  weekStart: string;
  groupName: string;
  rows: SheetRow[];
  warnings: string[];
};

const PRI: Record<string, number> = { P1: 1, P2: 2, P3: 3 };
const clean = (s: string | null | undefined) => (s ?? "").replace(/\r\n?/g, "\n").trim();

/** Blocker text first, then "Support: ..." on a new line. Empty when both are empty. User wording is kept as is. */
export function supportCell(blocker: string, support: string): string {
  const b = clean(blocker);
  const s = clean(support);
  return [b, s ? `Support: ${s}` : ""].filter(Boolean).join("\n");
}

export function buildSheetBlock(
  summary: WeekSummary,
  opts: { ownerFullName?: string | null; /** Short owner name filter, e.g. "Hennes". */ owner?: string; config?: SheetConfig; timeZone?: string } = {},
): SheetBlock {
  const cfg = opts.config ?? DEFAULT_SHEET_CONFIG;
  const tz = opts.timeZone ?? "Asia/Hong_Kong";
  const warnings: string[] = [];
  const ownerFilter = opts.owner?.trim().toLowerCase();

  const picked = summary.projects.filter((r) => !r.project.archived);
  // Owner filter matches the short owner name only (e.g. "Hennes"); projects without one are excluded when filtering.
  const filtered = ownerFilter ? picked.filter((r) => r.project.ownerShortName?.toLowerCase() === ownerFilter) : picked;

  const sorted = [...filtered].sort(
    (a, b) =>
      (PRI[a.project.priority] ?? 9) - (PRI[b.project.priority] ?? 9) ||
      (a.project.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.project.queueOrder ?? Number.MAX_SAFE_INTEGER) ||
      a.project.name.localeCompare(b.project.name),
  );

  const rows: SheetRow[] = sorted.map(({ project: p, update: u, blockers }) => {
    const warn = (what: string) => warnings.push(`${p.name}: ${what}`);
    if (!p.ownerShortName) warn("no owner short name set (Owner cell left blank)");
    if (!p.statusLabel) warn("no Status set (left blank; Status is never derived from RAG)");
    if (!u) warn("no update logged for this week (progress, next steps, blocker and Last updated left blank)");

    let progress = clean(u?.progressThisWeek);
    if (u && !progress && clean(u.progress)) {
      progress = clean(u.progress);
      warn('"Progress this week" not set; used the older "progress" text');
    } else if (u && !progress) warn('no "Progress this week" text');

    // Release date: real date for delivered, "(Target Date: ...)" text for planned, else the free-text note.
    let release: ReleaseCell = { kind: "empty" };
    if (p.releaseDate) {
      let type = p.releaseDateType;
      if (!type) {
        type = "target";
        warn("release date has no type (target/actual); treated as target");
      }
      release =
        type === "actual"
          ? { kind: "date", iso: p.releaseDate, display: formatIso(p.releaseDate, cfg.actualDateFormat) }
          : { kind: "text", text: formatIso(p.releaseDate, cfg.targetDateFormat) };
    } else if (clean(p.releaseDateNote)) {
      release = { kind: "text", text: clean(p.releaseDateNote) };
    } else warn("no release date (left blank)");

    // Latest change this week across the progress update and any task/blocker items.
    const stamps = [u, ...blockers].filter(Boolean).map((x) => x!.updatedAt.getTime());
    const last = stamps.length ? isoDateInTz(new Date(Math.max(...stamps)), tz) : null;

    const openBlockerItems = blockers.filter((b) => b.status !== "done").map((b) => clean(b.title));
    const blockerText = [clean(u?.blockers), ...openBlockerItems].filter(Boolean).join("; ");

    return {
      owner: clean(p.ownerShortName),
      requester: clean(p.requester),
      initiative: p.name,
      priority: p.priority,
      status: p.statusLabel ?? "",
      progressThisWeek: progress,
      totalProgress: p.progressPct / 100,
      nextSteps: clean(u?.nextSteps),
      release,
      support: supportCell(blockerText, u?.supportNeeded ?? ""),
      lastUpdated: last,
      lastUpdatedDisplay: last ? formatIso(last, cfg.lastUpdatedFormat) : "",
    };
  });

  const groupName = clean(opts.ownerFullName);
  if (!groupName) warnings.unshift("workspace owner full name is not set (group row would be empty). Use update_workspace_settings.");
  if (!rows.length) warnings.push(ownerFilter ? `no projects found for owner "${opts.owner}"` : "no projects to export");
  return { weekStart: summary.weekStart, groupName, rows, warnings };
}

/** Plain-text table of the block (dry run), so Claude can show it for confirmation. */
export function blockToText(
  b: SheetBlock,
  opts: { includeHeader?: boolean; includeGroupRow?: boolean } = {},
): string {
  const { includeHeader = true, includeGroupRow = true } = opts;
  const cell = (s: string) => s.replace(/\n/g, " ⏎ ");
  const line = (cells: string[]) => "| " + cells.map(cell).join(" | ") + " |";
  const out: string[] = [`Week of ${b.weekStart}: ${b.rows.length} row(s)`];
  if (includeHeader) out.push(line([...SHEET_HEADERS]));
  if (includeGroupRow) out.push(line([b.groupName]));
  for (const r of b.rows) {
    out.push(
      line([
        r.owner,
        r.requester,
        r.initiative,
        r.priority,
        r.status,
        r.progressThisWeek,
        `${Math.round(r.totalProgress * 100)}%`,
        r.nextSteps,
        r.release.kind === "date" ? r.release.display : r.release.kind === "text" ? r.release.text : "",
        r.support,
        r.lastUpdatedDisplay,
      ]),
    );
  }
  out.push(b.warnings.length ? "Warnings:" : "Warnings: none", ...b.warnings.map((w) => `- ${w}`));
  return out.join("\n");
}
