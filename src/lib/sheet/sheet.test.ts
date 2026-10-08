import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { WeekSummary } from "../services/summary";
import { DEFAULT_SHEET_CONFIG, excelNumFmt, formatIso, sheetConfigFrom } from "./config";
import { EXPECTED_CELLS, FIXTURE, FIXTURE_OWNER_FULL, FIXTURE_OWNER_SHORT, FIXTURE_WEEK } from "./fixture.hennes";
import { blockToText, buildSheetBlock, SHEET_HEADERS, supportCell, type SheetRow } from "./rows";
import { renderSheetXlsx } from "./xlsx";

type P = WeekSummary["projects"][number]["project"];
type U = NonNullable<WeekSummary["projects"][number]["update"]>;

/** Build a WeekSummary from the fixture without a database. */
function summaryFromFixture(over: { shuffle?: boolean } = {}): WeekSummary {
  const rows = FIXTURE.map((f, i) => {
    const project = {
      id: `p${i}`, workspaceId: "w", name: f.initiative, description: null, priority: f.priority, status: "amber",
      progressPct: f.progressPct, dueDate: null, requester: f.requester, ownerShortName: FIXTURE_OWNER_SHORT,
      statusLabel: f.statusLabel, releaseDate: f.release && "date" in f.release ? f.release.date : null,
      releaseDateType: f.release && "date" in f.release ? f.release.type : null,
      releaseDateNote: f.release && "note" in f.release ? f.release.note : null,
      queueOrder: f.queueOrder, archived: false, createdAt: new Date(), updatedAt: new Date(),
    } as P;
    const update = {
      id: `u${i}`, workspaceId: "w", projectId: project.id, weekStart: FIXTURE_WEEK, kind: "progress", title: null,
      wins: null, progress: null, progressThisWeek: f.progressThisWeek, nextSteps: f.nextSteps,
      blockers: f.blocker || null, supportNeeded: f.supportNeeded || null, rag: "amber", status: "open",
      createdAt: new Date(`${f.lastUpdated}T02:00:00Z`), updatedAt: new Date(`${f.lastUpdated}T02:00:00Z`),
    } as U;
    return { project, update, tasks: [], blockers: [] };
  });
  if (over.shuffle) rows.reverse();
  return { weekStart: FIXTURE_WEEK, weekEnd: "2026-10-11", projects: rows, missing: [], requests: [], achievements: [] };
}

const cells = (r: SheetRow): string[] => [
  r.owner, r.requester, r.initiative, r.priority, r.status, r.progressThisWeek, `${Math.round(r.totalProgress * 100)}%`,
  r.nextSteps, r.release.kind === "date" ? r.release.display : r.release.kind === "text" ? r.release.text : "",
  r.support, r.lastUpdatedDisplay,
];

describe("sheet rows", () => {
  it("reproduces the fixture table exactly (headers, Target Date text, dd/MM/yyyy, blanks, N%)", () => {
    const b = buildSheetBlock(summaryFromFixture({ shuffle: true }), { ownerFullName: FIXTURE_OWNER_FULL });
    expect(b.warnings).toEqual([]);
    expect(b.groupName).toBe("Hennes Lam");
    expect(b.rows.map(cells)).toEqual(EXPECTED_CELLS);
  });

  it("orders P1 first, then queue order, then name", () => {
    const s = summaryFromFixture();
    s.projects[5].project.queueOrder = 0; // an earlier P2 stays behind every P1
    s.projects[1].project.queueOrder = null; // null queue order goes last within its priority
    const names = buildSheetBlock(s, { ownerFullName: "H" }).rows.map((r) => r.initiative);
    expect(names.slice(0, 3)).toEqual(["PPL One Pager Fast Checkout flow", "ST sub-domain", "PPL Pass (Pass Gifting)"]);
    expect(names[3]).toBe("Adobe Staff Discount campaign");
  });

  it("support cell: blocker first, then 'Support: ...'; blank when both empty (never '-' or None)", () => {
    expect(supportCell("Waiting on legal", "Two QA hours")).toBe("Waiting on legal\nSupport: Two QA hours");
    expect(supportCell("", "Two QA hours")).toBe("Support: Two QA hours");
    expect(supportCell("Waiting on legal", "")).toBe("Waiting on legal");
    expect(supportCell("", "")).toBe("");
    expect(supportCell("  ", " ")).toBe("");
  });

  it("reports missing data as warnings and leaves cells blank; Status is never derived from RAG", () => {
    const s = summaryFromFixture();
    s.projects[0].project.statusLabel = null;
    s.projects[0].project.ownerShortName = null;
    s.projects[1].update = null;
    s.projects[2].project.releaseDate = null;
    s.projects[2].project.releaseDateType = null;
    s.projects[3].project.releaseDateType = null; // date without a type -> treated as target + warning
    const b = buildSheetBlock(s, { ownerFullName: "Hennes Lam" });
    const w = b.warnings.join("\n");
    expect(w).toMatch(/PPL One Pager[^\n]*no Status set[^\n]*never derived from RAG/);
    expect(w).toMatch(/PPL One Pager[^\n]*no owner short name/);
    expect(w).toMatch(/PPL Pass[^\n]*no update logged for this week/);
    expect(w).toMatch(/ST sub-domain[^\n]*no release date/);
    expect(w).toMatch(/Aerotel[^\n]*no type[^\n]*treated as target/);
    const row0 = b.rows.find((r) => r.initiative.startsWith("PPL One"))!;
    expect(row0.status).toBe("");
    expect(row0.owner).toBe("");
    const row1 = b.rows.find((r) => r.initiative === "PPL Pass (Pass Gifting)")!;
    expect([row1.progressThisWeek, row1.nextSteps, row1.support, row1.lastUpdatedDisplay]).toEqual(["", "", "", ""]);
    expect(JSON.stringify(b.rows)).not.toMatch(/None|N\/A|"-"/);
  });

  it("free-text release note (TBA/TBC) when there is no date; falls back to legacy 'progress' with a warning", () => {
    const s = summaryFromFixture();
    s.projects[0].project.releaseDate = null;
    s.projects[0].project.releaseDateType = null;
    s.projects[0].project.releaseDateNote = "TBA";
    s.projects[1].update!.progressThisWeek = null;
    s.projects[1].update!.progress = "Old style progress text";
    const b = buildSheetBlock(s, { ownerFullName: "Hennes Lam" });
    expect(b.rows.find((r) => r.initiative.startsWith("PPL One"))!.release).toEqual({ kind: "text", text: "TBA" });
    expect(b.rows.find((r) => r.initiative.startsWith("PPL Pass"))!.progressThisWeek).toBe("Old style progress text");
    expect(b.warnings.join("\n")).toMatch(/PPL Pass[^\n]*older "progress" text/);
  });

  it("Last updated uses the latest change of the week (blocker items too) in the workspace time zone", () => {
    const s = summaryFromFixture();
    s.projects[2].blockers = [{ ...s.projects[2].update!, kind: "blocker", title: "Need DNS", status: "open", updatedAt: new Date("2026-10-07T17:30:00Z") }];
    const row = buildSheetBlock(s, { ownerFullName: "H", timeZone: "Asia/Hong_Kong" }).rows.find((r) => r.initiative === "ST sub-domain")!;
    expect(row.lastUpdated).toBe("2026-10-08"); // 17:30Z is 01:30 on the 8th in Hong Kong
    expect(row.support).toBe("Need DNS");
  });

  it("owner filter matches the short owner name only", () => {
    const s = summaryFromFixture();
    s.projects[0].project.ownerShortName = "Nicholas";
    expect(buildSheetBlock(s, { ownerFullName: "H", owner: "hennes" }).rows).toHaveLength(6);
    expect(buildSheetBlock(s, { ownerFullName: "H", owner: "nobody" }).warnings.join()).toMatch(/no projects found for owner "nobody"/);
  });

  it("dry run text shows header, group row, rows and warnings", () => {
    const t = blockToText(buildSheetBlock(summaryFromFixture(), { ownerFullName: "Hennes Lam" }));
    expect(t).toContain("| " + SHEET_HEADERS.join(" | ") + " |");
    expect(t).toContain("| Hennes Lam |");
    expect(t).toContain("(Target Date: 10/30/2026)");
    expect(t).toContain("Warnings: none");
    expect(blockToText(buildSheetBlock(summaryFromFixture(), { ownerFullName: "H" }), { includeHeader: false, includeGroupRow: false })).not.toContain("Initiative");
  });
});

describe("sheet config", () => {
  it("formats dates from placeholders and converts to Excel formats", () => {
    expect(formatIso("2026-11-01", DEFAULT_SHEET_CONFIG.targetDateFormat)).toBe("(Target Date: 11/1/2026)");
    expect(formatIso("2026-10-06", DEFAULT_SHEET_CONFIG.actualDateFormat)).toBe("06/10/2026");
    expect(excelNumFmt("{DD}/{MM}/{YYYY}")).toBe("dd/mm/yyyy");
  });
  it("merges stored overrides and rejects bad formats", () => {
    expect(sheetConfigFrom({ sheet: { targetDateFormat: "(Target: {D}/{M}/{YYYY})" } }).targetDateFormat).toBe("(Target: {D}/{M}/{YYYY})");
    expect(() => sheetConfigFrom({ sheet: { targetDateFormat: "(Target: {X})" } })).toThrow(/unknown placeholder/);
    expect(() => sheetConfigFrom({ sheet: { actualDateFormat: "no tokens" } })).toThrow(/at least one/);
    expect(() => sheetConfigFrom({ sheet: { sheetName: "bad/name" } })).toThrow(/sheetName/);
  });
});

describe("xlsx render", () => {
  async function load(opts?: Parameters<typeof renderSheetXlsx>[1]) {
    const block = buildSheetBlock(summaryFromFixture(), { ownerFullName: "Hennes Lam" });
    const buf = await renderSheetXlsx(block, opts);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return { wb, ws: wb.worksheets[0] };
  }

  it("header row matches the team sheet exactly, in order, with its styling", async () => {
    const { ws } = await load();
    expect(ws.name).toBe("Current");
    expect(ws.getRow(1).values).toEqual([undefined, ...SHEET_HEADERS]);
    const h = ws.getCell("A1");
    expect(h.font).toMatchObject({ name: "Arial", size: 10, bold: true });
    expect(h.fill).toMatchObject({ fgColor: { argb: "FF6B1D3E" } });
    expect(ws.getColumn(3).width).toBeCloseTo(56.43, 1);
    expect(ws.getColumn(6).width).toBe(44);
  });

  it("group row is merged A:K with the full name; data rows reproduce the fixture", async () => {
    const { ws } = await load();
    expect(ws.getCell("A2").value).toBe("Hennes Lam");
    expect(ws.getCell("A2").isMerged).toBe(true);
    expect(ws.getCell("K2").isMerged).toBe(true);
    expect(ws.getCell("A2").fill).toMatchObject({ fgColor: { argb: "FFEAD9E0" } });
    EXPECTED_CELLS.forEach((exp, i) => {
      const r = ws.getRow(i + 3);
      const get = (c: number) => r.getCell(c).value;
      expect(get(1)).toBe(exp[0]);
      expect(get(3)).toBe(exp[2]);
      expect(get(5)).toBe(exp[4]);
      expect(get(6)).toBe(exp[5]);
      expect(r.getCell(7).value).toBeCloseTo(parseInt(exp[6]) / 100);
      expect(r.getCell(7).numFmt).toBe("0%");
      expect(get(8)).toBe(exp[7]);
      expect(get(10) ?? "").toBe(exp[9]);
      expect(r.getCell(11).numFmt).toBe("dd/mm/yyyy");
      expect((get(11) as Date).toISOString().slice(0, 10)).toBe("2026-10-05");
      // release: text for targets, a real date for delivered ones
      if (exp[8].startsWith("(")) expect(get(9)).toBe(exp[8]);
      else {
        expect((get(9) as Date).toISOString().slice(0, 10)).toBe("2026-10-06");
        expect(r.getCell(9).numFmt).toBe("dd/mm/yyyy");
      }
      expect(r.getCell(3).alignment).toMatchObject({ wrapText: true, vertical: "top" });
      expect(r.height).toBeGreaterThanOrEqual(15);
    });
  });

  it("blank cells stay blank (no placeholders) and status cells carry the sheet's colours", async () => {
    const { ws } = await load();
    const st = ws.getRow(5); // ST sub-domain: no blocker
    expect(st.getCell(10).value).toBeNull();
    expect(st.getCell(5).fill).toMatchObject({ fgColor: { argb: "FFC6EFCE" } }); // On track
    expect(ws.getRow(4).getCell(5).fill).toMatchObject({ fgColor: { argb: "FFFFC7CE" } }); // Blocked
    expect((ws.getRow(3).getCell(5).fill as { fgColor?: unknown } | undefined)?.fgColor).toBeUndefined(); // To Start: no fill
    const all: unknown[] = [];
    ws.eachRow((row) => row.eachCell((c) => all.push(c.value)));
    expect(all.filter((v) => ["None", "-", "N/A"].includes(String(v)))).toEqual([]);
  });

  it("include_header / include_group_row can be turned off", async () => {
    const { ws } = await load({ includeHeader: false, includeGroupRow: false });
    expect(ws.rowCount).toBe(7);
    expect(ws.getCell("C1").value).toBe("PPL One Pager Fast Checkout flow");
  });
});
