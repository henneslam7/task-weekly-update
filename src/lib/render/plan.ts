// Pure planning: validate the payload and turn it into slide data (used by dry run and rendering).
import MAP from "./layout_map.json";

export const L = MAP.limits;
export type Rag = "red" | "amber" | "green";
const RAG_ORDER: Record<string, number> = { red: 0, amber: 1, green: 2 };
const RAG_ALIASES: Record<string, Rag> = { r: "red", a: "amber", yellow: "amber", orange: "amber", g: "green" };

export class DeckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckError";
  }
}

export type DeckProject = {
  name: string;
  priority?: string;
  rag: string;
  progress_pct: number;
  next_steps?: string;
  blocker?: string;
};
export type DeckPayload = {
  week_start: string;
  focus_line?: string;
  wins: string[];
  progress: string[];
  blockers: string[];
  support_needed: string[];
  projects: DeckProject[];
};

export type StatusRow = { name: string; priority: string; rag: Rag; pct: number; next: string; blocker: string };
export type Block = { kind: "heading" | "bullet" | "empty"; text: string };
export type SummaryColumn = { head: string; accent: "yellow" | "red"; blocks: Block[] };
export type SummarySlide = { type: "summary"; title: string; sub: string[]; columns: SummaryColumn[] };
export type StatusSlide = { type: "status"; title: string; sub: string[]; rows: StatusRow[] };
export type PlannedSlide = SummarySlide | StatusSlide;

export function truncate(s: unknown, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

const normRag = (v: unknown): Rag => {
  const k = String(v ?? "").toLowerCase();
  return (RAG_ALIASES[k] ?? k) as Rag;
};

export function validate(p: unknown): asserts p is DeckPayload {
  if (!p || typeof p !== "object") throw new DeckError("Payload must be an object");
  const o = p as Record<string, unknown>;
  const errs: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.week_start ?? "")) || isNaN(Date.parse(String(o.week_start))))
    errs.push("week_start: required, ISO date YYYY-MM-DD");
  for (const k of ["wins", "progress", "blockers", "support_needed", "projects"])
    if (!Array.isArray(o[k])) errs.push(`${k}: required, must be an array (may be empty)`);
  (Array.isArray(o.projects) ? (o.projects as DeckProject[]) : []).forEach((r, i) => {
    if (!r || !String(r.name ?? "").trim()) errs.push(`projects[${i}].name: required`);
    if (!(normRag(r?.rag) in RAG_ORDER)) errs.push(`projects[${i}].rag: must be red|amber|green (got "${r?.rag}")`);
    const pc = Number(r?.progress_pct);
    if (!(pc >= 0 && pc <= 100)) errs.push(`projects[${i}].progress_pct: required number 0-100`);
  });
  if (errs.length) throw new DeckError("Invalid payload:\n  - " + errs.join("\n  - "));
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
};

// ---- Pagination of the summary cards -------------------------------------------------------------------
// Text is never shrunk below BULLET_PT and never replaced by "+N more": overflow goes to continuation slides.
export const BULLET_PT = 14;
const LINE_PT = BULLET_PT * 1.2;
const BULLET_GAP_PT = 5;
const HEAD_PT = 9 * 1.2 + 4; // group label (9pt) + space after
const HEAD_GAP_PT = 10; // extra space above a group label that is not first on the page
const CHAR_EM = 0.48; // average Arial glyph width in em (slightly conservative; Liberation Sans measured ~0.45 on sample text)
const SLACK = 0.95; // keep 5% free at the bottom of a card

/** Lines needed for `text` at the bullet font size in a text box `widthIn` wide (greedy word wrap). */
export function countLines(text: string, widthIn: number): number {
  const cpl = Math.max(8, Math.floor((widthIn * 72 - 12) / (BULLET_PT * CHAR_EM)));
  let lines = 1;
  let cur = 0;
  for (const w of text.split(" ")) {
    let len = w.length;
    while (len > cpl) {
      // unbreakable run longer than a line: it wraps by character
      if (cur > 0) lines++;
      lines += Math.floor((len - 1) / cpl);
      len = len % cpl || cpl;
      cur = 0;
    }
    if (cur === 0) cur = len;
    else if (cur + 1 + len <= cpl) cur += 1 + len;
    else {
      lines++;
      cur = len;
    }
  }
  return lines;
}

type Group = { heading?: string; items: string[] };

/** Flow the groups of one card into pages that fit `capPt`; a group label is repeated when its list continues. */
export function paginateColumn(groups: Group[], textWidthIn: number, capPt: number): Block[][] {
  const cap = capPt * SLACK;
  const pages: Block[][] = [[]];
  let used = 0;
  let shown = false; // current group's label already on this page
  const page = () => pages[pages.length - 1];
  const headH = () => HEAD_PT + (page().length ? HEAD_GAP_PT : 0);
  const newPage = () => {
    pages.push([]);
    used = 0;
    shown = false;
  };
  for (const g of groups) {
    shown = false;
    const items = g.items.map((t) => truncate(t, L.maxBulletChars)).filter(Boolean);
    if (!items.length) {
      const need = (g.heading ? headH() : 0) + LINE_PT + BULLET_GAP_PT;
      if (used + need > cap && page().length) newPage();
      if (g.heading) {
        used += headH();
        page().push({ kind: "heading", text: g.heading });
      }
      used += LINE_PT + BULLET_GAP_PT;
      page().push({ kind: "empty", text: "None this week" });
      continue;
    }
    for (const t of items) {
      const h = countLines(t, textWidthIn) * LINE_PT + BULLET_GAP_PT;
      let need = h + (g.heading && !shown ? headH() : 0);
      if (used + need > cap && page().length) {
        newPage();
        need = h + (g.heading ? headH() : 0);
      }
      if (g.heading && !shown) {
        used += headH();
        page().push({ kind: "heading", text: g.heading });
        shown = true;
      }
      used += h;
      page().push({ kind: "bullet", text: t });
    }
  }
  return pages;
}

export function plan(p: unknown): PlannedSlide[] {
  validate(p);
  const week = fmtDate(p.week_start);
  const sub = [`Week of ${week}`];
  if (p.focus_line) sub.push(truncate(p.focus_line, L.focusLineChars));
  const projects: StatusRow[] = p.projects
    .map((r, i) => ({ r, i, rag: normRag(r.rag) }))
    .sort((a, b) => RAG_ORDER[a.rag] - RAG_ORDER[b.rag] || a.i - b.i)
    .map(({ r, rag }) => ({
      name: truncate(r.name, 40),
      priority: truncate(r.priority || "-", 12),
      rag,
      pct: Math.round(Number(r.progress_pct)),
      next: truncate(r.next_steps || "-", L.nextStepsChars),
      blocker: truncate(r.blocker || "-", L.blockerChars),
    }));

  // Summary cards: same geometry as drawSummary (3 cards, text box = card width - 0.4in, height = content area - header).
  const cardW = (MAP.contentArea.w - 2 * 0.25) / 3;
  const capPt = (MAP.contentArea.h - 0.65 - 0.15) * 72;
  const cards: { head: string; accent: "yellow" | "red"; groups: Group[] }[] = [
    { head: "Wins", accent: "yellow", groups: [{ items: p.wins }] },
    { head: "Key progress", accent: "yellow", groups: [{ items: p.progress }] },
    {
      head: "Blockers & support needed",
      accent: "red",
      groups: [
        { heading: "Blockers", items: p.blockers },
        { heading: "Support needed", items: p.support_needed },
      ],
    },
  ];
  const paged = cards.map((c) => ({ ...c, pages: paginateColumn(c.groups, cardW - 0.4, capPt) }));
  const nSummary = Math.max(...paged.map((c) => c.pages.length));
  const slides: PlannedSlide[] = [];
  for (let k = 0; k < nSummary; k++) {
    const cols = paged.filter((c) => c.pages[k]).map((c) => ({ head: c.head, accent: c.accent, blocks: c.pages[k] }));
    const heads = cols.map((c) => c.head);
    slides.push({
      type: "summary",
      title:
        k === 0
          ? "Executive summary"
          : `${heads.length === cards.length ? "Executive summary" : heads.join(" & ")} (cont.${k > 1 ? " " + k : ""})`,
      sub: k === 0 ? sub : [`Week of ${week}`],
      columns: cols,
    });
  }

  const per = L.maxProjectRowsPerSlide;
  const pages = Math.max(1, Math.ceil(projects.length / per));
  for (let k = 0; k < pages; k++)
    slides.push({
      type: "status",
      title: pages > 1 ? `Project status (${k + 1} of ${pages})` : "Project status",
      sub:
        k === 0
          ? [
              `Week of ${week}`,
              `${projects.length} projects: ${(["red", "amber", "green"] as Rag[])
                .map((c) => projects.filter((x) => x.rag === c).length + " " + c)
                .join(", ")}`,
            ]
          : [`Week of ${week}`],
      rows: projects.slice(k * per, (k + 1) * per),
    });
  return slides;
}

export function dryRunText(slides: PlannedSlide[]): string {
  const out: string[] = [`Total slides: ${slides.length}`, ...slides.map((s, i) => `  ${i + 1}. ${s.title}`), ""];
  slides.forEach((s, i) => {
    out.push(`=== Slide ${i + 1} of ${slides.length}: ${s.title} (${s.type}) ===`, ...s.sub.map((t) => "  > " + t));
    if (s.type === "summary")
      for (const c of s.columns) {
        out.push(`  [${c.head}]`);
        for (const b of c.blocks)
          out.push(b.kind === "heading" ? `    ${b.text}:` : b.kind === "empty" ? `    ${b.text}` : `    - ${b.text}`);
      }
    else
      s.rows.forEach((r) =>
        out.push(`  | ${r.name} | ${r.priority} | ${r.rag.toUpperCase()} | ${r.pct}% | ${r.next} | ${r.blocker}`),
      );
  });
  return out.join("\n");
}
