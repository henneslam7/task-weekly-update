// Render the team-sheet block as .xlsx (exceljs). Styling copied from the team's real tracker:
// Arial 10, header fill 6B1D3E with white bold text, group row fill EAD9E0 (bold 11, colour 6B1D3E, merged A:K),
// wrapped top-aligned data cells, Total Progress as a number with a 0% format, real date cells for dates.
import ExcelJS from "exceljs";
import { DEFAULT_SHEET_CONFIG, excelNumFmt, type SheetConfig } from "./config";
import { SHEET_HEADERS, type SheetBlock } from "./rows";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Column widths of the team sheet's "Current" tab (A:B 18.43, C 56.43, D 9, E 12, F 44, G 18.71, H:I 40, J 36, K 13). */
const WIDTHS = [18.43, 18.43, 56.43, 9, 12, 44, 18.71, 40, 40, 36, 13];
const FONT = "Arial";
const BRAND = "FF6B1D3E";
const GROUP_FILL = "FFEAD9E0";
/** Same colours as the team sheet's Status conditional formatting; "To Start" has no fill there. */
const STATUS_FILL: Record<string, string> = {
  "On track": "FFC6EFCE",
  "At risk": "FFFFEB9C",
  Blocked: "FFFFC7CE",
  Done: "FFD9D9D9",
};

/** Rough wrapped line count for Arial 10 in a column `width` wide (Excel units); slightly generous. */
function lines(text: string, width: number): number {
  const cpl = Math.max(4, Math.floor(width * 1.1));
  return text.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / cpl)), 0);
}

export async function renderSheetXlsx(
  block: SheetBlock,
  opts: { includeHeader?: boolean; includeGroupRow?: boolean; config?: SheetConfig } = {},
): Promise<Buffer> {
  const { includeHeader = true, includeGroupRow = true } = opts;
  const cfg = opts.config ?? DEFAULT_SHEET_CONFIG;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Weekly Update Portal";
  const ws = wb.addWorksheet(cfg.sheetName, { views: [{ showGridLines: false }] });
  ws.columns = WIDTHS.map((width) => ({ width }));
  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; // prints on one page wide

  let r = 0;

  if (includeHeader) {
    r++;
    const row = ws.getRow(r);
    SHEET_HEADERS.forEach((h, i) => {
      const c = row.getCell(i + 1);
      c.value = h;
      c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
      c.alignment = { vertical: "middle" };
    });
    row.height = 21.75;
  }

  if (includeGroupRow) {
    r++;
    const row = ws.getRow(r);
    ws.mergeCells(r, 1, r, 11);
    for (let i = 1; i <= 11; i++) {
      const c = row.getCell(i);
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GROUP_FILL } };
      c.font = { name: FONT, size: 11, bold: true, color: { argb: BRAND } };
    }
    row.getCell(1).value = block.groupName;
    row.height = 15;
  }

  const dateCell = (c: ExcelJS.Cell, iso: string, numFmt: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    c.value = new Date(Date.UTC(y, m - 1, d)); // UTC midnight -> exact calendar date in Excel
    c.numFmt = numFmt;
  };

  for (const x of block.rows) {
    r++;
    const row = ws.getRow(r);
    const releaseText = x.release.kind === "text" ? x.release.text : "";
    const texts = [x.owner, x.requester, x.initiative, x.priority, x.status, x.progressThisWeek, "", x.nextSteps, releaseText, x.support, ""];
    for (let i = 0; i < 11; i++) {
      const c = row.getCell(i + 1);
      // Blank stays blank: never write None, "-" or N/A.
      if (texts[i] !== "") c.value = texts[i];
      c.font = { name: FONT, size: 10 };
      c.alignment = { wrapText: true, vertical: "top" };
    }
    const g = row.getCell(7);
    g.value = x.totalProgress; // 0.1 with format 0% shows "10%" and stays numeric for the sheet's Summary formulas
    g.numFmt = "0%";
    if (x.release.kind === "date") dateCell(row.getCell(9), x.release.iso, excelNumFmt(cfg.actualDateFormat));
    if (x.lastUpdated) dateCell(row.getCell(11), x.lastUpdated, excelNumFmt(cfg.lastUpdatedFormat));
    const fill = STATUS_FILL[x.status];
    if (fill) row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

    const need = Math.max(1, ...texts.map((t, i) => (t ? lines(t, WIDTHS[i]) : 1)));
    row.height = Math.max(15, need * 12.75 + 3);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
