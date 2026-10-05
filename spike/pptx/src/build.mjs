// Weekly deck generator: reuses PPG_PPT_Templates_2026.pptx (slide 11) via pptx-automizer.
// Usage: node src/build.mjs payload.json [--template path] [--out out/deck.pptx] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Automizer, modify } from 'pptx-automizer';
import { slim } from './slim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MAP = JSON.parse(fs.readFileSync(path.join(here, 'layout_map.json'), 'utf8'));
const B = MAP.brand, L = MAP.limits, A = MAP.contentArea;
const RAG_ORDER = { red: 0, amber: 1, green: 2 };
const RAG_ALIASES = { r: 'red', a: 'amber', yellow: 'amber', orange: 'amber', g: 'green' };

export class DeckError extends Error {}

export function truncate(s, max) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

export function validate(p) {
  const errs = [];
  if (!p || typeof p !== 'object') throw new DeckError('Payload must be a JSON object');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.week_start ?? '') || isNaN(Date.parse(p.week_start)))
    errs.push('week_start: required, ISO date YYYY-MM-DD');
  for (const k of ['wins', 'progress', 'blockers', 'support_needed', 'projects'])
    if (!Array.isArray(p[k])) errs.push(`${k}: required, must be an array (may be empty)`);
  (Array.isArray(p.projects) ? p.projects : []).forEach((r, i) => {
    if (!r || !String(r.name ?? '').trim()) errs.push(`projects[${i}].name: required`);
    const rag = String(r?.rag ?? '').toLowerCase();
    if (!(RAG_ORDER[RAG_ALIASES[rag] ?? rag] >= 0)) errs.push(`projects[${i}].rag: must be red|amber|green (got "${r?.rag}")`);
    const pc = Number(r?.progress_pct);
    if (!(pc >= 0 && pc <= 100)) errs.push(`projects[${i}].progress_pct: required number 0-100`);
  });
  if (errs.length) throw new DeckError('Invalid payload:\n  - ' + errs.join('\n  - '));
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };

/** Pick the largest font size at which the bullets fit; else drop trailing bullets with "+N more". */
export function fitBullets(items, widthIn, heightIn) {
  const list = items.map((t) => truncate(t, L.maxBulletChars)).filter(Boolean);
  for (const size of [14, 13, 12, 11, 10, 9]) {
    const cpl = Math.floor(((widthIn - 0.35) * 72) / (size * 0.5));
    const lineH = size * 1.2, gap = 5;
    let used = 0, n = 0;
    for (const t of list) {
      const h = Math.ceil(t.length / cpl) * lineH + gap;
      if (used + h > heightIn * 72) break;
      used += h; n++;
    }
    if (n === list.length) return { size, items: list };
    if (size === 9) {
      const keep = Math.max(n - 1, 0);
      return { size, items: [...list.slice(0, keep), `+${list.length - keep} more (see portal)`] };
    }
  }
}

/** Plan the deck as plain data (used by both dry-run and rendering). */
export function plan(p) {
  validate(p);
  const week = fmtDate(p.week_start);
  const sub = [`Week of ${week}`];
  if (p.focus_line) sub.push(truncate(p.focus_line, L.focusLineChars));
  const projects = p.projects
    .map((r, i) => ({ r, i, rag: RAG_ALIASES[String(r.rag).toLowerCase()] ?? String(r.rag).toLowerCase() }))
    .sort((a, b) => RAG_ORDER[a.rag] - RAG_ORDER[b.rag] || a.i - b.i) // red first, stable
    .map(({ r, rag }) => ({
      name: truncate(r.name, 40), priority: truncate(r.priority || '-', 12), rag,
      pct: Math.round(Number(r.progress_pct)), next: truncate(r.next_steps || '-', L.nextStepsChars),
      blocker: truncate(r.blocker || '-', L.blockerChars),
    }));
  const slides = [{ type: 'summary', title: 'Executive summary', sub, columns: [
    { head: 'Wins', items: p.wins },
    { head: 'Key progress', items: p.progress },
    { head: 'Blockers & support needed', groups: [['Blockers', p.blockers], ['Support needed', p.support_needed]] },
  ] }];
  const pages = Math.max(1, Math.ceil(projects.length / L.maxProjectRowsPerSlide));
  for (let k = 0; k < pages; k++)
    slides.push({ type: 'status', title: pages > 1 ? `Project status (${k + 1} of ${pages})` : 'Project status',
      sub: k === 0 ? [`Week of ${week}`, `${projects.length} projects: ${['red', 'amber', 'green'].map((c) => projects.filter((x) => x.rag === c).length + ' ' + c).join(', ')}`] : [`Week of ${week}`],
      rows: projects.slice(k * L.maxProjectRowsPerSlide, (k + 1) * L.maxProjectRowsPerSlide) });
  return slides;
}

export function dryRun(slides) {
  const out = [];
  slides.forEach((s, i) => {
    out.push(`=== Slide ${i + 1}: ${s.title} (${s.type}) ===`, ...s.sub.map((t) => '  > ' + t));
    if (s.type === 'summary') for (const c of s.columns) {
      out.push(`  [${c.head}]`);
      for (const [h, items] of c.groups ?? [[null, c.items]]) {
        if (h) out.push(`    ${h}:`);
        const w = 3.95, hgt = c.groups ? 1.6 : 3.9, f = fitBullets(items, w, hgt);
        out.push(...f.items.map((t) => `    - ${t}`), `    (font ${f.size}pt)`);
      }
    } else s.rows.forEach((r) => out.push(`  | ${r.name} | ${r.priority} | ${r.rag.toUpperCase()} | ${r.pct}% | ${r.next} | ${r.blocker}`));
  });
  return out.join('\n');
}

const RAGC = MAP.rag;
const titleCase = (s) => s[0].toUpperCase() + s.slice(1);

function drawSummary(s, slide) {
  const gap = 0.25, cw = (A.w - 2 * gap) / 3;
  s.columns.forEach((c, i) => {
    const x = A.x + i * (cw + gap);
    slide.addShape('rect', { x, y: A.y, w: cw, h: A.h, fill: { color: B.paper }, line: { color: B.paper } });
    slide.addShape('rect', { x, y: A.y, w: cw, h: 0.07, fill: { color: i === 2 ? RAGC.red : B.yellow }, line: { type: 'none' } });
    slide.addText(c.head, { x: x + 0.2, y: A.y + 0.15, w: cw - 0.4, h: 0.4, fontFace: B.headFont, fontSize: 18, color: B.ink, margin: 0 });
    const groups = c.groups ?? [[null, c.items]];
    let y = A.y + 0.65;
    const avail = A.h - 0.65 - 0.15;
    groups.forEach(([h, items]) => {
      const gh = c.groups ? avail / 2 : avail;
      let top = y, hh = gh;
      if (h) { slide.addText(h.toUpperCase(), { x: x + 0.2, y, w: cw - 0.4, h: 0.25, fontFace: B.bodyFont, fontSize: 9, bold: true, charSpacing: 2, color: '7A7468', margin: 0 }); top += 0.3; hh -= 0.3; }
      const f = fitBullets(items, cw, hh - 0.05);
      const runs = f.items.length ? f.items.map((t) => ({ text: t, options: { bullet: { indent: 12 }, breakLine: true, paraSpaceAfter: 5 } }))
        : [{ text: 'None this week', options: { italic: true, color: '7A7468' } }];
      slide.addText(runs, { x: x + 0.2, y: top, w: cw - 0.4, h: hh - 0.05, valign: 'top', fontFace: B.bodyFont, fontSize: f.size, color: B.ink, margin: 0 });
      y += gh;
    });
  });
}

function drawStatus(s, slide) {
  const hdr = (t, al = 'left') => ({ text: t, options: { bold: true, color: B.ink, fill: { color: B.yellow }, align: al, fontFace: B.bodyFont, fontSize: 10 } });
  const cell = (t, o = {}) => ({ text: t, options: { fontFace: B.bodyFont, fontSize: 9, color: B.ink, valign: 'middle', ...o } });
  const rows = [[hdr('Project'), hdr('Priority'), hdr('RAG', 'center'), hdr('Progress', 'center'), hdr('Next steps'), hdr('Blocker')]];
  s.rows.forEach((r, i) => {
    const fill = { color: i % 2 ? 'FFFFFF' : B.paper };
    rows.push([
      cell(r.name, { bold: true, fill }), cell(r.priority, { fill }),
      cell(titleCase(r.rag), { bold: true, align: 'center', color: r.rag === 'amber' ? B.ink : 'FFFFFF', fill: { color: RAGC[r.rag] } }),
      cell(r.pct + '%', { align: 'center', fill }), cell(r.next, { fill }), cell(r.blocker, { fill }),
    ]);
  });
  slide.addTable(rows, { x: A.x, y: A.y, w: A.w, colW: [2.3, 0.9, 0.8, 1.0, 4.2, 3.0], rowH: [0.38, ...s.rows.map(() => 0.58)],
    border: { type: 'solid', pt: 0.5, color: B.stone }, margin: [0.04, 0.08, 0.04, 0.08] });
}

export async function buildDeck(payload, { templatePath, outPath }) {
  const slides = plan(payload);
  if (!templatePath || !fs.existsSync(templatePath))
    throw new DeckError(`Template not found: ${templatePath}. Download PPG_PPT_Templates_2026.pptx (see FINDINGS.md) or pass --template.`);
  const t0 = Date.now();
  const dir = path.dirname(path.resolve(templatePath));
  const auto = new Automizer({ templateDir: dir, outputDir: path.resolve(path.dirname(outPath)), removeExistingSlides: true, autoImportSlideMasters: true, cleanup: true, compression: 9 });
  let pres = auto.loadRoot(path.basename(templatePath)).load(path.basename(templatePath), 'T');
  const { title, subtitle, content } = Object.fromEntries(Object.entries(MAP.shapes).map(([k, v]) => [k, v.name]));
  for (const s of slides) {
    pres = pres.addSlide('T', MAP.template_slide, (sl) => {
      sl.modifyElement(title, modify.setText(s.title));
      sl.modifyElement(subtitle, modify.setMultiText(s.sub.map((t, i) => ({ paragraph: { spaceAfter: 4 }, text: t, style: { fontFamily: 'Arial', size: i === 0 ? 1400 : 1100, isBold: i === 0 } }))));
      sl.removeElement(content);
      sl.generate((ps) => (s.type === 'summary' ? drawSummary(s, ps) : drawStatus(s, ps)), 'content');
    });
  }
  let summary;
  try { summary = await pres.write(path.basename(outPath)); }
  catch (e) { throw new DeckError(`Template shape lookup/render failed (${e.message}). Expected shapes ${JSON.stringify(MAP.shapes)} on template slide ${MAP.template_slide} - see src/layout_map.json.`); }
  const slimmed = await slim(fs.readFileSync(outPath));
  fs.writeFileSync(outPath, slimmed);
  return { slides: slides.length, ms: Date.now() - t0, summary };
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
  try {
    if (!file) throw new DeckError('Usage: node src/build.mjs payload.json [--template path] [--out out/deck.pptx] [--dry-run]');
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new DeckError(`Cannot read payload ${file}: ${e.message}`); }
    if (args.includes('--dry-run')) console.log(dryRun(plan(payload)));
    else {
      const outPath = opt('--out', 'out/weekly.pptx');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const r = await buildDeck(payload, { templatePath: opt('--template', path.join(here, '../../../templates/PPG_PPT_Templates_2026.pptx')), outPath });
      console.log(`OK ${outPath}: ${r.slides} slides, ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB, ${r.ms} ms, rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
    }
  } catch (e) {
    console.error(e instanceof DeckError ? `ERROR: ${e.message}` : e);
    process.exit(e instanceof DeckError ? 2 : 1);
  }
}
