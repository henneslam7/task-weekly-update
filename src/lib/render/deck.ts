// Deck renderer: copies template slide(s) via pptx-automizer, fills named shapes, draws cards / native table.
import fs from "node:fs";
import path from "node:path";
import { Automizer, modify } from "pptx-automizer";
import MAP from "./layout_map.json";
import { DeckError, fitBullets, plan, dryRunText, type PlannedSlide, type SummarySlide, type StatusSlide } from "./plan";
import { slim } from "./slim";

export { DeckError } from "./plan";
export type { DeckPayload } from "./plan";

const B = MAP.brand;
const A = MAP.contentArea;
const RAGC = MAP.rag as Record<string, string>;
const titleCase = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The committed, pre-slimmed brand template (single slide + its layout/master, ~50 KB). */
export function defaultTemplatePath(): string {
  return path.join(process.cwd(), "src/lib/render/assets/ppg-weekly-template.pptx");
}

// pptxgenjs slide objects are loosely typed by pptx-automizer.
/* eslint-disable @typescript-eslint/no-explicit-any */
function drawSummary(s: SummarySlide, slide: any) {
  const gap = 0.25;
  const cw = (A.w - 2 * gap) / 3;
  s.columns.forEach((c, i) => {
    const x = A.x + i * (cw + gap);
    slide.addShape("rect", { x, y: A.y, w: cw, h: A.h, fill: { color: B.paper }, line: { color: B.paper } });
    slide.addShape("rect", { x, y: A.y, w: cw, h: 0.07, fill: { color: i === 2 ? RAGC.red : B.yellow }, line: { type: "none" } });
    slide.addText(c.head, { x: x + 0.2, y: A.y + 0.15, w: cw - 0.4, h: 0.4, fontFace: B.headFont, fontSize: 18, color: B.ink, margin: 0 });
    const groups = c.groups ?? ([[null, c.items ?? []]] as [string | null, string[]][]);
    let y = A.y + 0.65;
    const avail = A.h - 0.65 - 0.15;
    groups.forEach(([h, items]) => {
      const gh = c.groups ? avail / 2 : avail;
      let top = y;
      let hh = gh;
      if (h) {
        slide.addText(h.toUpperCase(), { x: x + 0.2, y, w: cw - 0.4, h: 0.25, fontFace: B.bodyFont, fontSize: 9, bold: true, charSpacing: 2, color: "7A7468", margin: 0 });
        top += 0.3;
        hh -= 0.3;
      }
      const f = fitBullets(items, cw, hh - 0.05);
      const runs = f.items.length
        ? f.items.map((t) => ({ text: t, options: { bullet: { indent: 12 }, breakLine: true, paraSpaceAfter: 5 } }))
        : [{ text: "None this week", options: { italic: true, color: "7A7468" } }];
      slide.addText(runs, { x: x + 0.2, y: top, w: cw - 0.4, h: hh - 0.05, valign: "top", fontFace: B.bodyFont, fontSize: f.size, color: B.ink, margin: 0 });
      y += gh;
    });
  });
}

function drawStatus(s: StatusSlide, slide: any) {
  const hdr = (t: string, al = "left") => ({ text: t, options: { bold: true, color: B.ink, fill: { color: B.yellow }, align: al, fontFace: B.bodyFont, fontSize: 10 } });
  const cell = (t: string, o: Record<string, unknown> = {}) => ({ text: t, options: { fontFace: B.bodyFont, fontSize: 9, color: B.ink, valign: "middle", ...o } });
  const rows: any[][] = [[hdr("Project"), hdr("Priority"), hdr("RAG", "center"), hdr("Progress", "center"), hdr("Next steps"), hdr("Blocker")]];
  s.rows.forEach((r, i) => {
    const fill = { color: i % 2 ? "FFFFFF" : B.paper };
    rows.push([
      cell(r.name, { bold: true, fill }),
      cell(r.priority, { fill }),
      cell(titleCase(r.rag), { bold: true, align: "center", color: r.rag === "amber" ? B.ink : "FFFFFF", fill: { color: RAGC[r.rag] } }),
      cell(r.pct + "%", { align: "center", fill }),
      cell(r.next, { fill }),
      cell(r.blocker, { fill }),
    ]);
  });
  slide.addTable(rows, {
    x: A.x, y: A.y, w: A.w, colW: [2.3, 0.9, 0.8, 1.0, 4.2, 3.0], rowH: [0.38, ...s.rows.map(() => 0.58)],
    border: { type: "solid", pt: 0.5, color: B.stone }, margin: [0.04, 0.08, 0.04, 0.08],
  });
}

export type BuildOptions = {
  dryRun?: boolean;
  /** Template pptx; defaults to the committed slimmed asset. */
  templatePath?: string;
  /** Set when templatePath is the full 12-slide brand template (uses template_slide instead of template_slide_slim). */
  fullTemplate?: boolean;
};
export type BuildResult = { slides: PlannedSlide[]; text: string; buffer?: Buffer };

/** Validate + plan; with dryRun returns only the planned slide text, otherwise also renders the pptx in memory. */
export async function buildDeck(payload: unknown, opts: BuildOptions = {}): Promise<BuildResult> {
  const slides = plan(payload);
  const text = dryRunText(slides);
  if (opts.dryRun) return { slides, text };
  const templatePath = opts.templatePath ?? defaultTemplatePath();
  if (!fs.existsSync(/*turbopackIgnore: true*/ templatePath)) throw new DeckError(`Template not found: ${templatePath}`);
  const file = path.basename(templatePath);
  const auto = new Automizer({
    templateDir: path.dirname(path.resolve(/*turbopackIgnore: true*/ templatePath)),
    removeExistingSlides: true,
    autoImportSlideMasters: true,
    cleanup: true,
    compression: 9,
  });
  let pres = auto.loadRoot(file).load(file, "T");
  const slideNo = opts.fullTemplate ? MAP.template_slide : MAP.template_slide_slim;
  const { title, subtitle, content } = Object.fromEntries(Object.entries(MAP.shapes).map(([k, v]) => [k, v.name]));
  for (const s of slides)
    pres = pres.addSlide("T", slideNo, (sl) => {
      sl.modifyElement(title, modify.setText(s.title));
      sl.modifyElement(
        subtitle,
        modify.setMultiText(
          s.sub.map((t, i) => ({
            paragraph: { spaceAfter: 4 },
            text: t,
            style: { fontFamily: "Arial", size: i === 0 ? 1400 : 1100, isBold: i === 0 },
          })),
        ),
      );
      sl.removeElement(content);
      sl.generate((ps: any) => (s.type === "summary" ? drawSummary(s, ps) : drawStatus(s, ps)), "content");
    });
  let raw: Buffer;
  try {
    const zip = await pres.getJSZip();
    raw = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (e) {
    throw new DeckError(
      `Template shape lookup/render failed (${(e as Error).message}). Expected shapes ${JSON.stringify(MAP.shapes)} on template slide ${slideNo} - see src/lib/render/layout_map.json.`,
    );
  }
  return { slides, text, buffer: await slim(raw) };
}
