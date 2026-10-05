import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDeck, type DeckPayload } from "./index";
import sample from "./sample-payload.json";

const blocker = (i: number) => `Project ${i}: waiting on vendor sign-off for item ${i}, owner chasing`;
const mk = (nBlockers: number, nProjects = 8): DeckPayload => ({
  ...(sample as DeckPayload),
  blockers: Array.from({ length: nBlockers }, (_, i) => blocker(i + 1)),
  projects: (sample as DeckPayload).projects.slice(0, nProjects),
});
const summaries = (r: Awaited<ReturnType<typeof buildDeck>>) => r.slides.filter((s) => s.type === "summary");
const statuses = (r: Awaited<ReturnType<typeof buildDeck>>) => r.slides.filter((s) => s.type === "status");

describe("deck pagination (nothing truncated, nothing sent to the portal)", () => {
  for (const n of [3, 5, 12]) {
    it(`${n} blockers + 8 projects: every blocker appears, no "+N more", total count listed`, async () => {
      const r = await buildDeck(mk(n), { dryRun: true });
      expect(r.text).not.toMatch(/see portal|\+\d+ more/i);
      for (let i = 1; i <= n; i++) expect(r.text).toContain(blocker(i));
      expect(r.text).toContain(`Total slides: ${r.slides.length}`);
      expect(statuses(r)).toHaveLength(2); // 8 projects, 6 per slide
      if (n === 3) expect(summaries(r)).toHaveLength(1);
      if (n === 12) {
        expect(summaries(r).length).toBeGreaterThan(1);
        expect(r.slides[1].title).toBe("Blockers & support needed (cont.)");
        expect(r.slides[1].type).toBe("summary");
        // continuation slides carry only the card that continues
        expect(summaries(r)[1]).toMatchObject({ columns: [{ head: "Blockers & support needed" }] });
      }
      // dry run lists every slide, continuation slides included
      r.slides.forEach((s, i) => expect(r.text).toContain(`${i + 1}. ${s.title}`));
    });
  }

  it("repeats the group label when a list continues on the next slide", async () => {
    const r = await buildDeck(mk(12), { dryRun: true });
    const cont = r.text.split("=== Slide 2 of")[1].split("=== Slide 3 of")[0];
    expect(cont).toMatch(/Blockers:/);
  });

  it("paginates Wins and Key progress when they overflow", async () => {
    const wins = Array.from({ length: 14 }, (_, i) => `Win ${i + 1}: shipped something worth reporting to the boss`);
    const r = await buildDeck({ ...mk(2), wins }, { dryRun: true });
    for (let i = 1; i <= 14; i++) expect(r.text).toContain(`Win ${i}:`);
    expect(r.slides[1].title).toBe("Wins (cont.)");
  });

  it("paginates the status table at 6 rows per slide", async () => {
    const projects = Array.from({ length: 13 }, (_, i) => ({ name: "P" + i, rag: "green", progress_pct: 10 }));
    const r = await buildDeck({ ...mk(1), projects }, { dryRun: true });
    expect(statuses(r)).toHaveLength(3);
    for (const s of statuses(r)) expect((s as { rows: unknown[] }).rows.length).toBeLessThanOrEqual(6);
  });

  it("renders 12 blockers at 14pt with every blocker in the pptx", async () => {
    const r = await buildDeck(mk(12));
    const zip = await JSZip.loadAsync(r.buffer!);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(names).toHaveLength(r.slides.length);
    const xml = (await Promise.all(names.map((n) => zip.file(n)!.async("string")))).join("");
    for (let i = 1; i <= 12; i++) expect(xml).toContain(blocker(i));
    expect(xml).not.toMatch(/see portal/);
    expect(xml).toContain('sz="1400"');
    expect(xml).not.toMatch(/sz="(1[0-3]00|900)"[^>]*>\s*(<[^>]+>\s*)*<a:t>Project \d+: waiting/);
  });
});
