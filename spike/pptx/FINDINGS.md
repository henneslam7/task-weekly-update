# PPTX spike: weekly deck from the real PPG template (pptx-automizer 0.9.4)

Verdict: **works.** 2 content slides (+ overflow status slides) generated from the real template slide/master/layout, output **~75 KB** (template is 17 MB), ~2 s, ~230 MB peak RSS, plain Node 22, no native deps.

## Run
```
cd spike/pptx && npm install
node src/build.mjs samples/payload.json --dry-run          # planned slide text
node src/build.mjs samples/payload.json --out out/weekly.pptx [--template path]
```
Default template path: `../../templates/PPG_PPT_Templates_2026.pptx` (git-ignored). Exit code 2 + readable `ERROR:` on missing template / invalid payload (all field errors listed at once).
Files: `src/build.mjs` (validate, plan, dry-run, render, CLI; exports `buildDeck`, `plan`, `dryRun`), `src/slim.mjs` (post-process), `src/layout_map.json` (shape-name map, brand colours, limits), `samples/payload.json`.

## How it works
- Template inspected: 12 slides, brand style (yellow FCDC00, stone CEC5B7, paper F0F1ED, Times New Roman headlines, Arial body, "Plaza Premium Group / PPC" footer from master). All 15 layouts exist but slides are mostly placeholder rectangles/textboxes; theme colours are Office defaults, brand colours are hard-coded in slides.
- Both output slides are copies of **template slide 11** (layout "Section Header": white content frame, headline top-left, body top-right, big grey placeholder). `addSlide('T', 11)` keeps original master/layout/footer.
- Filled by shape name (see `layout_map.json`): `TextBox 2` = title (setText), `Rectangle 3` = "Week of ..." + focus line (setMultiText, Arial), `Rectangle 1` (grey placeholder) is removed and replaced with generated content.
- Slide 1 (Executive summary): three cards (Wins / Key progress / Blockers & support needed with two sub-lists) drawn with pptxgenjs shapes via `slide.generate`, brand colours/fonts.
- Slide 2+ (Project status): **native PowerPoint table** (pptxgenjs `addTable` through `generate`; editable in PowerPoint). Yellow header, zebra rows, RAG cell filled red D64545 / amber F2A900 / green 3E9B5F with the label (colour-blind safe). `modify.setTable` was not usable: the template has no table to modify.
- Lorem ipsum and the other 11 template slides do not appear in the output.

## Rules for long content
- Bullets truncated to 200 chars; focus line 220; next steps 120; blocker 90; name 40 (ellipsis).
- Cards: font steps 14 -> 9 pt until the estimated text fits; at 9 pt remaining bullets are replaced by "+N more (see portal)".
- Max 7 project rows per slide, overflow goes to extra "Project status (k of n)" slides. Rows sorted red, amber, green (stable).
- Estimation uses average char width (0.5 em), so it is conservative (cards may look slightly emptier than needed). Verify with real data.

## Size
Automizer alone leaves a 12-16 MB file (orphan template slides, a duplicated master, all 15 layouts and their 7.7 MB / 3 MB images + EMFs, even with `cleanup:true`). `src/slim.mjs` (jszip) keeps only the used master/layout and garbage-collects unreachable parts -> 75 KB. The used layout has no images. If the owner later picks a layout/slide with photos (title slides use 3-8 MB JPG/PNG) the output grows accordingly; compress those images in the template.

## Caveats / limits
- Rendering checked in LibreOffice (needed `apt install libreoffice-impress`, not present by default); PowerPoint not available here. Headline font Times New Roman and Arial are used, LibreOffice substitutes metric-compatible fonts; the real brand sans in the title slides is an image/other font not used here.
- pptx-automizer is add-only; shape lookups by name fail if the owner renames/deletes shapes: the error message points to `layout_map.json`.
- `modify.setMultiText` size is in 1/100 pt, `fontFamily` (not `typeface`).
- Generated shapes get auto names (`content-<uuid>`); not an issue unless later edited by script.
- Output contains empty notes master and one extra theme from the template; harmless.
- Not tested in PowerPoint desktop/Keynote: do one open-and-edit check before shipping (table is native, slides standard OOXML; python-pptx opens it).

## What the owner should do to the template
1. In Selection Pane (Alt+F10) on slide 11, rename `TextBox 2` -> `wk_title`, `Rectangle 3` -> `wk_subtitle`, `Rectangle 1` -> `wk_content`, then update `layout_map.json` (or keep current names; they work today).
2. Better: add a dedicated "Weekly Update" slide (copy of slide 11, placeholder text removed, headline and body placeholders named) so slide numbers do not shift when templates are reordered (we reference slide index 11; or look up by label).
3. Optional: set theme accent colours to the brand yellow/stone so charts and tables inherit them, and compress slide images (17 MB).

## Vercel
- Do not bundle the 17 MB file in the function. Store it in private Vercel Blob (client upload, >4.5 MB request cap); in the route: `const { url } = await head(path)` / `get`, `fetch` (server to Blob has no 4.5 MB limit), write to `/tmp` (only writable dir) and pass `templateDir: '/tmp'`. Cache in a module variable between warm invocations. Alternative: pre-slim the template once (keep only slide 11 + its master/layout) so the template itself is ~100 KB and can be committed or bundled; recommended.
- Automizer writes a work dir/output via fs: use `/tmp` for `outputDir`, read the buffer, `put()` the result to Blob and return a signed URL (response cap 4.5 MB).
- Memory ~230 MB peak, ~2 s: well within 1-2 GB / 60 s. Needs `node:fs` so use the Node runtime, not Edge.
