# Task Weekly Update Portal

Personal work portal + remote MCP server. Talk to Claude, Claude records
projects / weekly updates / requests / achievements, then exports a weekly
`.pptx` using your company template.

## Confidentiality warning

- This runs on **personal** infrastructure (Vercel, Neon). Check your employer's IT policy.
- Store only **short, de-identified** descriptions. No internal revenue numbers,
  customer names or unreleased product details.
- The company template is company property. The full 17 MB file is never
  committed (`*.pptx` / `*.potx` are git-ignored, keep it in `templates/`). Only
  a slimmed ~50 KB layout (one placeholder slide + brand footer, no content) is
  committed with `git add -f`, see `DECISIONS.md` "Export deck". Delete both when
  you leave. Generated decks go to a PRIVATE Blob store only.
- Secrets live only in environment variables. Never commit `.env*`.

## Export deck

Week summary page: "Preview slide text" (dry run) and "Export deck" (renders a
.pptx in memory, uploads to private Vercel Blob, shows a 10-minute download link;
past exports are listed). Needs `BLOB_READ_WRITE_TOKEN` and a private Blob store.
CLI/dev check of the renderer: `npx vitest run src/lib/render`.

## Status

Design agreed. See `DECISIONS.md` for stack choices and `HANDOVER.md` plan.
