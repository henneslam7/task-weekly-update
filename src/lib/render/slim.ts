// Post-process a pptx: keep only the used master/layout, drop every part that is no
// longer reachable (template media, other layouts), and strip document metadata
// (SharePoint customXml, thumbnail of the original first slide, author names).
import JSZip from "jszip";
import path from "node:path";

const posix = path.posix;
const relsPath = (p: string) => posix.join(posix.dirname(p), "_rels", posix.basename(p) + ".rels");
type Rel = { id: string; type: string; target: string; mode?: string; raw: string };
const parseRels = (xml: string): Rel[] =>
  [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const g = (k: string) => (m[0].match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
    return { id: g("Id"), type: g("Type"), target: g("Target"), mode: g("TargetMode"), raw: m[0] };
  });
const resolve = (from: string, t: string) =>
  t.startsWith("/") ? t.slice(1) : posix.normalize(posix.join(posix.dirname(from), t));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const METADATA_TARGET = /(^|\/)(customXml\/|docProps\/thumbnail|docProps\/custom\.xml)/;

export async function slim(buf: Buffer | Uint8Array): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const text = async (p: string) => zip.file(p)!.async("string");
  let pres = await text("ppt/presentation.xml");
  let presRels = await text(relsPath("ppt/presentation.xml"));
  const prels = parseRels(presRels);
  const byId = Object.fromEntries(prels.map((r) => [r.id, r]));
  const slideIds = [...pres.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)![1].matchAll(/r:id="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const usedLayouts = new Set<string>();
  const usedMasters = new Set<string>();
  for (const id of slideIds) {
    const sp = resolve("ppt/presentation.xml", byId[id].target);
    const l = parseRels(await text(relsPath(sp))).find((r) => r.type.endsWith("/slideLayout"))!;
    const lp = resolve(sp, l.target);
    usedLayouts.add(lp);
    usedMasters.add(
      resolve(lp, parseRels(await text(relsPath(lp))).find((r) => r.type.endsWith("/slideMaster"))!.target),
    );
  }
  // slide relationships that are not in sldIdLst (leftovers of removed template slides) and metadata parts
  for (const r of prels)
    if (
      r.type.endsWith("/slideLayout") ||
      (r.type.endsWith("/slide") && !slideIds.includes(r.id)) ||
      METADATA_TARGET.test(r.target)
    )
      presRels = presRels.replace(r.raw, "");
  const mIds = [...pres.matchAll(/<p:sldMasterId\b[^>]*r:id="([^"]+)"[^>]*\/>/g)];
  for (const m of mIds)
    if (!usedMasters.has(resolve("ppt/presentation.xml", byId[m[1]].target))) {
      pres = pres.replace(m[0], "");
      presRels = presRels.replace(byId[m[1]].raw, "");
    }
  for (const mp of usedMasters) {
    let mx = await text(mp);
    let mr = await text(relsPath(mp));
    for (const r of parseRels(mr).filter((r) => r.type.endsWith("/slideLayout")))
      if (!usedLayouts.has(resolve(mp, r.target))) {
        mx = mx.replace(new RegExp(`<p:sldLayoutId\\b[^>]*r:id="${r.id}"[^>]*/>`), "");
        mr = mr.replace(r.raw, "");
      }
    zip.file(mp, mx);
    zip.file(relsPath(mp), mr);
  }
  zip.file("ppt/presentation.xml", pres);
  zip.file(relsPath("ppt/presentation.xml"), presRels);

  // package-level relationships: drop thumbnail / custom properties
  let rootRels = await text("_rels/.rels");
  for (const r of parseRels(rootRels)) if (METADATA_TARGET.test(r.target)) rootRels = rootRels.replace(r.raw, "");
  zip.file("_rels/.rels", rootRels);
  // author names
  if (zip.file("docProps/core.xml")) {
    const core = (await text("docProps/core.xml"))
      .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, "<dc:creator></dc:creator>")
      .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy></cp:lastModifiedBy>");
    zip.file("docProps/core.xml", core);
  }

  // garbage-collect unreachable parts
  const reach = new Set<string>(["[Content_Types].xml", "_rels/.rels"]);
  const q = parseRels(rootRels).map((r) => resolve("x", r.target));
  while (q.length) {
    const p = q.pop()!;
    if (reach.has(p) || !zip.file(p)) continue;
    reach.add(p);
    const rp = relsPath(p);
    if (zip.file(rp)) {
      reach.add(rp);
      for (const r of parseRels(await text(rp))) if (r.mode !== "External") q.push(resolve(p, r.target));
    }
  }
  let ct = await text("[Content_Types].xml");
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || reach.has(name)) continue;
    zip.remove(name);
    ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${esc(name)}"[^>]*/>`), "");
  }
  zip.file("[Content_Types].xml", ct);
  return renumber(zip);
}

/**
 * pptx-automizer looks parts up by "slide1.xml", "slideMaster1.xml", ... so after dropping parts we
 * renumber each family to 1..n and rewrite every relationship target and content-type override.
 */
async function renumber(zip: JSZip): Promise<Buffer> {
  const families = ["slides/slide", "slideMasters/slideMaster", "slideLayouts/slideLayout", "theme/theme"];
  const map = new Map<string, string>();
  for (const fam of families) {
    const re = new RegExp(`^ppt/${esc(fam)}(\\d+)\\.xml$`);
    const olds = Object.keys(zip.files)
      .filter((n) => re.test(n))
      .sort((a, b) => Number(a.match(re)![1]) - Number(b.match(re)![1]));
    olds.forEach((o, i) => map.set(o, `ppt/${fam}${i + 1}.xml`));
  }
  const out = new JSZip();
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (f.dir) continue;
    let target = map.get(name) ?? name;
    let body: string | Buffer;
    const relOf = name.match(/^(.*)\/_rels\/(.*)\.rels$/);
    if (relOf) {
      const src = posix.join(relOf[1], relOf[2]);
      if (map.has(src)) target = relsPath(map.get(src)!);
      let xml = await f.async("string");
      xml = xml.replace(/\bTarget="([^"]*)"/g, (m, t: string) => {
        if (/^[a-z]+:/i.test(t)) return m;
        const n = map.get(resolve(src, t));
        return n ? `Target="${t.startsWith("/") ? "/" + n : posix.relative(posix.dirname(src), n)}"` : m;
      });
      body = xml;
    } else if (name === "[Content_Types].xml") {
      body = (await f.async("string")).replace(/PartName="\/([^"]*)"/g, (m, pn: string) =>
        map.has(pn) ? `PartName="/${map.get(pn)}"` : m,
      );
    } else body = await f.async("nodebuffer");
    out.file(target, body);
  }
  return out.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
