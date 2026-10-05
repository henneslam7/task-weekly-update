import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDeck, DeckError } from "./index";
import sample from "./sample-payload.json";

describe("buildDeck", () => {
  it("dry run returns planned text without rendering", async () => {
    const r = await buildDeck(sample, { dryRun: true });
    expect(r.buffer).toBeUndefined();
    expect(r.text).toContain("Executive summary");
    expect(r.text).toContain("Week of 28 Sep 2026");
    expect(r.slides).toHaveLength(3); // summary + 8 projects over 2 status slides
    // red first
    expect(r.text.indexOf("| ALLWAYS terms page")).toBeLessThan(r.text.indexOf("| Lounge booking funnel"));
  });

  it("lists every field error at once", async () => {
    await expect(buildDeck({ projects: [{ name: "", rag: "x", progress_pct: 500 }] }, { dryRun: true })).rejects.toThrow(
      /week_start[\s\S]*wins[\s\S]*projects\[0\]\.name[\s\S]*rag[\s\S]*progress_pct/,
    );
    await expect(buildDeck(null, { dryRun: true })).rejects.toBeInstanceOf(DeckError);
  });

  it("truncates long text and caps rows per slide", async () => {
    const projects = Array.from({ length: 15 }, (_, i) => ({ name: "P" + i, rag: "green", progress_pct: 10, next_steps: "x".repeat(500) }));
    const r = await buildDeck({ ...sample, projects }, { dryRun: true });
    expect(r.slides.filter((s) => s.type === "status")).toHaveLength(3);
    expect(r.text).not.toContain("x".repeat(160));
  });

  it("renders a small, valid pptx from the committed slimmed template", async () => {
    const r = await buildDeck(sample);
    const buf = r.buffer!;
    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf.length).toBeLessThan(500_000);
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(3);
    const all = (await Promise.all(slides.map((n) => zip.file(n)!.async("string")))).join("");
    expect(all).toContain("Executive summary");
    expect(all).toContain("Kentico CMS migration");
    expect(all).toContain("<a:tbl>"); // native table
    expect(all).not.toMatch(/Lorem|placeholder for Images/i);
    expect(zip.file("docProps/thumbnail.jpeg")).toBeNull();
    expect(Object.keys(zip.files).some((n) => n.startsWith("customXml"))).toBe(false);
  });
});
