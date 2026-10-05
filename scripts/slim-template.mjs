// One-off: pre-slim the full brand template to the single slide(s) we need.
// Usage (Node 22): node --experimental-strip-types scripts/slim-template.mjs <full.pptx> [out.pptx]
// Review the output for confidential content before committing it (see DECISIONS.md).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Automizer } from "pptx-automizer";
import { slim } from "../src/lib/render/slim.ts";

const src = path.resolve(process.argv[2] ?? "templates/PPG_PPT_Templates_2026.pptx");
const out = path.resolve(process.argv[3] ?? "src/lib/render/assets/ppg-weekly-template.pptx");
const map = JSON.parse(fs.readFileSync("src/lib/render/layout_map.json", "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slim-"));
const a = new Automizer({ templateDir: path.dirname(src), outputDir: tmp, removeExistingSlides: true, autoImportSlideMasters: true, cleanup: true });
await a.loadRoot(path.basename(src)).load(path.basename(src), "T").addSlide("T", map.template_slide).write("raw.pptx");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await slim(fs.readFileSync(path.join(tmp, "raw.pptx"))));
fs.rmSync(tmp, { recursive: true });
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
