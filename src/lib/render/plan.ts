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
export type SummarySlide = {
  type: "summary";
  title: string;
  sub: string[];
  columns: { head: string; items?: string[]; groups?: [string, string[]][] }[];
};
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

/** Pick the largest font size at which the bullets fit; else drop trailing bullets with "+N more". */
export function fitBullets(items: string[], widthIn: number, heightIn: number): { size: number; items: string[] } {
  const list = items.map((t) => truncate(t, L.maxBulletChars)).filter(Boolean);
  let last = { size: 9, items: list };
  for (const size of [14, 13, 12, 11, 10, 9]) {
    const cpl = Math.floor(((widthIn - 0.35) * 72) / (size * 0.5));
    const lineH = size * 1.2;
    const gap = 5;
    let used = 0;
    let n = 0;
    for (const t of list) {
      const h = Math.ceil(t.length / cpl) * lineH + gap;
      if (used + h > heightIn * 72) break;
      used += h;
      n++;
    }
    if (n === list.length) return { size, items: list };
    const keep = Math.max(n - 1, 0);
    last = { size, items: [...list.slice(0, keep), `+${list.length - keep} more (see portal)`] };
  }
  return last;
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
  const slides: PlannedSlide[] = [
    {
      type: "summary",
      title: "Executive summary",
      sub,
      columns: [
        { head: "Wins", items: p.wins },
        { head: "Key progress", items: p.progress },
        {
          head: "Blockers & support needed",
          groups: [
            ["Blockers", p.blockers],
            ["Support needed", p.support_needed],
          ],
        },
      ],
    },
  ];
  const pages = Math.max(1, Math.ceil(projects.length / L.maxProjectRowsPerSlide));
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
      rows: projects.slice(k * L.maxProjectRowsPerSlide, (k + 1) * L.maxProjectRowsPerSlide),
    });
  return slides;
}

export function dryRunText(slides: PlannedSlide[]): string {
  const out: string[] = [];
  slides.forEach((s, i) => {
    out.push(`=== Slide ${i + 1}: ${s.title} (${s.type}) ===`, ...s.sub.map((t) => "  > " + t));
    if (s.type === "summary")
      for (const c of s.columns) {
        out.push(`  [${c.head}]`);
        for (const [h, items] of c.groups ?? ([[null, c.items ?? []]] as [string | null, string[]][])) {
          if (h) out.push(`    ${h}:`);
          const f = fitBullets(items, 3.95, c.groups ? 1.6 : 3.9);
          out.push(...(f.items.length ? f.items : ["None this week"]).map((t) => `    - ${t}`), `    (font ${f.size}pt)`);
        }
      }
    else
      s.rows.forEach((r) =>
        out.push(`  | ${r.name} | ${r.priority} | ${r.rag.toUpperCase()} | ${r.pct}% | ${r.next} | ${r.blocker}`),
      );
  });
  return out.join("\n");
}
