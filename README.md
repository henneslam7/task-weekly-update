# Task Weekly Update Portal

Personal work portal + remote MCP server. Talk to Claude, Claude records
projects / weekly updates / requests / achievements, then exports a weekly
`.pptx` using your company template.

## Confidentiality warning

- This runs on **personal** infrastructure (Vercel, Neon). Check your employer's IT policy.
- Store only **short, de-identified** descriptions. No internal revenue numbers,
  customer names or unreleased product details.
- The company template is company property. Keep it only in the workspace's
  private storage, never commit it (`*.pptx` / `*.potx` are git-ignored), and
  delete it when you leave.
- Secrets live only in environment variables. Never commit `.env*`.

## Status

Design agreed. See `DECISIONS.md` for stack choices and `HANDOVER.md` plan.
