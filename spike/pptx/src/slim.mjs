// Post-process: drop unused masters/layouts and every part no longer reachable (mainly template media).
import JSZip from 'jszip';
import path from 'node:path';

const posix = path.posix;
const relsPath = (p) => posix.join(posix.dirname(p), '_rels', posix.basename(p) + '.rels');
const parseRels = (xml) => [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
  const g = (k) => (m[0].match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
  return { id: g('Id'), type: g('Type'), target: g('Target'), mode: g('TargetMode'), raw: m[0] };
});
const resolve = (from, t) => (t.startsWith('/') ? t.slice(1) : posix.normalize(posix.join(posix.dirname(from), t)));

export async function slim(buf) {
  const zip = await JSZip.loadAsync(buf);
  const text = async (p) => zip.file(p).async('string');
  let pres = await text('ppt/presentation.xml');
  let presRels = await text(relsPath('ppt/presentation.xml'));
  const prels = parseRels(presRels);
  const byId = Object.fromEntries(prels.map((r) => [r.id, r]));
  // slides in use -> layouts -> masters
  const slideIds = [...pres.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)[1].matchAll(/r:id="([^"]+)"/g)].map((m) => m[1]);
  const usedLayouts = new Set(), usedMasters = new Set();
  for (const id of slideIds) {
    const sp = resolve('ppt/presentation.xml', byId[id].target);
    const l = parseRels(await text(relsPath(sp))).find((r) => r.type.endsWith('/slideLayout'));
    const lp = resolve(sp, l.target); usedLayouts.add(lp);
    usedMasters.add(resolve(lp, parseRels(await text(relsPath(lp))).find((r) => r.type.endsWith('/slideMaster')).target));
  }
  // drop slide relationships that are not in sldIdLst (leftovers of removed template slides)
  for (const r of prels) if ((r.type.endsWith('/slideLayout') || (r.type.endsWith('/slide') && !slideIds.includes(r.id)))) presRels = presRels.replace(r.raw, '');
  // remove unused masters from presentation
  const mIds = [...pres.matchAll(/<p:sldMasterId\b[^>]*r:id="([^"]+)"[^>]*\/>/g)];
  for (const m of mIds) if (!usedMasters.has(resolve('ppt/presentation.xml', byId[m[1]].target))) {
    pres = pres.replace(m[0], '');
    presRels = presRels.replace(byId[m[1]].raw, '');
  }
  // remove unused layouts from used masters
  for (const mp of usedMasters) {
    let mx = await text(mp), mr = await text(relsPath(mp));
    for (const r of parseRels(mr).filter((r) => r.type.endsWith('/slideLayout')))
      if (!usedLayouts.has(resolve(mp, r.target))) {
        mx = mx.replace(new RegExp(`<p:sldLayoutId\\b[^>]*r:id="${r.id}"[^>]*/>`), '');
        mr = mr.replace(r.raw, '');
      }
    zip.file(mp, mx); zip.file(relsPath(mp), mr);
  }
  zip.file('ppt/presentation.xml', pres); zip.file(relsPath('ppt/presentation.xml'), presRels);
  // garbage-collect unreachable parts
  const reach = new Set(['[Content_Types].xml']), q = ['_rels/.rels'];
  reach.add('_rels/.rels');
  const roots = parseRels(await text('_rels/.rels')).map((r) => resolve('x', r.target));
  q.length = 0; q.push(...roots);
  while (q.length) {
    const p = q.pop(); if (reach.has(p) || !zip.file(p)) continue; reach.add(p);
    const rp = relsPath(p);
    if (zip.file(rp)) { reach.add(rp); for (const r of parseRels(await text(rp))) if (r.mode !== 'External') q.push(resolve(p, r.target)); }
  }
  let ct = await text('[Content_Types].xml');
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || reach.has(name)) continue;
    zip.remove(name);
    ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), '');
  }
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}
