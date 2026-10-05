# HANDOVER: Personal Work Portal + MCP Server

> Audience: Claude Code. Owner: Hennes (UI/UX Manager, e-commerce). Language of owner: Cantonese / Traditional Chinese / English.
> Status: design only. Nothing is built yet. Treat every "Recommended" item as a default that you may challenge after checking constraints.

---

## 1. Goal

Hennes wants to **talk to Claude** and have Claude do the record-keeping:

1. Claude records projects, tasks, weekly updates, blockers and incoming requests into a **Portal** (web app + database).
2. Claude drafts what should be filled in (wins, progress, next steps, blockers, RAG status) from Hennes' casual chat.
3. Claude triggers a **one-call export** that produces a `.pptx` using the **company template**, and returns a download link.
4. The Portal must be **reusable for the next job**: one Workspace per employer, fully separated.

The Portal holds the data and does the rendering. **Claude (via MCP) is the conversational front-end.** Do not build a second AI layer inside the Portal for the MVP.

## 2. Business context (why this exists)

- Boss asked for **weekly updates**: wins, key initiatives, progress, issues needing attention. Deadline is **Friday noon**, or a recap by **Monday noon**.
- Boss wants visibility on: what is progressing, what is pending/blocked, where support or prioritisation is needed. **Not extra reporting for its own sake**, so output must be short.
- Hennes must focus on already-assigned UI design projects (ST sub-domain, PPL Pass) and **redirect any new request to Nicholas** (or the boss). The Portal should keep an auditable **Request Log** showing requests were redirected.
- Hennes also wants an **Achievement Log** (what was done + numbers) to feed CV / LinkedIn later, and to carry across jobs.

## 3. Architecture

```
Claude (claude.ai / Desktop / Code)
   │  MCP (tools)
   ▼
MCP Server  ──────────────►  Portal API (same Next.js app)
                                 │
                 ┌───────────────┼────────────────┐
                 ▼               ▼                ▼
          Supabase Postgres  Supabase Storage   PPTX renderer
          (data + RLS)       (templates, exports) (python-pptx)
```

### Recommended stack

| Layer | Choice | Note |
|---|---|---|
| Web app | Next.js (App Router, TypeScript) on Vercel | Dashboard + share link |
| DB + Auth | Supabase (Postgres, Auth, Storage) | Use Row Level Security |
| MCP server | TypeScript, hosted as a route in the same Next.js app (e.g. `/api/mcp`) using the official MCP TypeScript SDK or Vercel's MCP adapter | Verify current package names and Streamable HTTP support before choosing |
| PPTX render | `python-pptx` opening the real company `.pptx`/`.potx` and filling layout placeholders | Needed for true template fidelity |
| Alternative PPTX | `pptxgenjs` | Builds from scratch. Does NOT truly reuse a template. Fallback only |

**Open decision for you:** `python-pptx` is Python, the app is Node. Options: (a) Vercel Python serverless function, (b) tiny separate service (FastAPI on Fly/Render/Railway), (c) run it locally first. Pick the simplest that works and document why. Do not assume (a) works without testing size/runtime limits.

### MCP transport and auth (important, easy to get wrong)

- **Phase 1:** run the MCP server locally over **stdio** so it works with Claude Desktop and Claude Code immediately. No OAuth needed.
- **Phase 2:** expose it as a **remote MCP server** (Streamable HTTP) so it can be added as a custom connector in claude.ai. Remote connectors need proper auth. Check the current MCP authorization spec (OAuth 2.1) before implementing. Do not invent a custom scheme and do not ship an unauthenticated public endpoint.
- Single-user for now, but design `user_id` and `workspace_id` into every table so multi-user is not a rewrite.

## 4. Data model (draft, adjust freely)

All tables carry `workspace_id` and are protected by RLS (user can only see workspaces they belong to).

```sql
workspace      (id, name, owner_user_id, brand_config jsonb, created_at)
project        (id, workspace_id, name, description, priority text,        -- P1/P2/P3
                status text,                                              -- green/amber/red/done
                progress_pct int, due_date date, requester text,
                archived bool, created_at, updated_at)
weekly_update  (id, project_id, week_start date, wins text, progress text,
                next_steps text, blockers text, support_needed text,
                rag text, created_at)                                     -- unique(project_id, week_start)
task           (id, project_id, title, status, due_date, notes)
blocker        (id, project_id, description, raised_on, resolved_on, owner)
request_log    (id, workspace_id, received_on, from_person, summary,
                outcome text,                                             -- accepted / redirected / declined
                redirected_to text, project_id nullable)
achievement    (id, workspace_id, project_id nullable, title, what_was_done,
                metric text, period, cv_bullet text)
report_template(id, workspace_id, name, storage_path, layout_map jsonb, active bool)
export_job     (id, workspace_id, week_start, format, storage_path, created_at)
```

`layout_map` maps logical fields (e.g. `exec_summary.wins`, `status_table`) to the template's layout names / placeholder indexes. Discover these by inspecting the real template. Do not guess.

## 5. MCP tools (contract)

Keep tools few, coarse and idempotent. Every write tool should return the saved record so Claude can confirm to the user. Use Zod (or equivalent) schemas with clear descriptions, since Claude reads them.

| Tool | Purpose | Key inputs |
|---|---|---|
| `list_projects` | Current projects with latest status | `workspace`, `include_archived?` |
| `upsert_project` | Create/update a project | `name`, `priority?`, `status?`, `progress_pct?`, `due_date?`, `requester?` |
| `log_weekly_update` | Save this week's update for a project | `project`, `week_start?` (default current week), `wins`, `progress`, `next_steps`, `blockers`, `support_needed`, `rag` |
| `get_week_summary` | Return everything for a week, ready for Claude to review/edit | `week_start?` |
| `log_request` | Record an incoming request and its outcome | `from_person`, `summary`, `outcome`, `redirected_to?` |
| `add_achievement` | Record a result with numbers | `title`, `what_was_done`, `metric?`, `project?` |
| `export_weekly_deck` | Render pptx from template, return a signed download URL | `week_start?`, `template?` |
| `export_markdown` | Plain-text version for email/Slack | `week_start?` |
| `list_missing_updates` | Which active projects have no update this week | `week_start?` |
| `export_cv_bullets` | Achievements as CV/LinkedIn bullets | `since?`, `workspace?` |

Design rules:
- **Return a URL, not binary,** for exports (signed Supabase Storage URL, short expiry).
- `export_weekly_deck` must fail loudly with a readable message if the template or any required field is missing. No silent blank slides.
- Prefer defaults so Hennes can speak loosely ("log ST sub-domain, amber, waiting on dev") and Claude can still call the tool correctly.
- Add a `dry_run` option on export that returns the planned slide content as text so Claude can show Hennes before rendering.

### Intended conversation flow

1. Hennes: "ST sub-domain wireframe done, PPL Pass waiting on content, someone asked for a banner."
2. Claude calls `list_projects`, then `log_weekly_update` (x2) and `log_request` (outcome: redirected to Nicholas).
3. Claude calls `list_missing_updates`, then `get_week_summary`, and shows a short draft for confirmation.
4. Hennes: "OK, export."
5. Claude calls `export_weekly_deck` and returns the link.

## 6. Slide output spec

Default weekly deck, 2 slides, using the company template's own layouts, fonts and colours:

1. **Executive summary**: Wins, Key progress, Blockers & support needed. Optional footer line: "Focus: <P1 projects>. New requests redirected to Nicholas: N."
2. **Project status table**: Project, Priority, RAG, Progress %, Next steps, Blocker.

Rules: concise wording, nothing that is not in the database, language configurable per workspace (English / Traditional Chinese).

## 7. Multi-job portability

- One **Workspace per employer**. Templates, brand config, projects and requests never cross workspaces.
- **Achievement Log is the only thing meant to travel.** Keep achievement text generic and free of confidential detail so it can be exported to a CV when changing jobs.
- On leaving a job: export achievements, then archive/delete that workspace's templates and project data.

## 8. Risks and constraints (read before building)

1. **Company confidentiality / IT policy.** Putting work content on a personal Vercel/Supabase account may breach the employer's policy. Default to storing **short, de-identified descriptions**: no internal revenue figures, no customer names, no unreleased product details. Add this warning to the README.
2. **Template ownership.** The company template is company property. Store it only inside that workspace, and delete it on exit. Never commit it to a public repo. Add template files and `.env*` to `.gitignore`.
3. **Secrets.** Supabase service key and MCP auth secrets only in environment variables. Never in the repo.
4. **Do not over-engineer.** The boss needs visibility, not a pretty dashboard. Ship the MVP before UI polish.
5. **Unverified assumptions to test early:** python-pptx fidelity on the real template; Vercel Python runtime limits; claude.ai custom connector auth requirements.

## 9. Phased plan and acceptance criteria

**Phase 0: Inputs needed from Hennes**
- The real company template (`.pptx`/`.potx`), and an example of a past weekly deck if any.
- Confirmation of which cadence (Friday noon or Monday noon) and which language the deck uses.
- Confirmation that hosting on personal infrastructure is acceptable, or an alternative (company-approved tool).

**Phase 1: MVP (local)**
- Supabase project, schema + RLS, seed one workspace.
- stdio MCP server with: `list_projects`, `upsert_project`, `log_weekly_update`, `get_week_summary`, `log_request`, `export_markdown`.
- Done when: from Claude Desktop/Code, Hennes can create projects, log an update by chat, and get a Markdown summary.

**Phase 2: Template export**
- Inspect template layouts, fill `layout_map`, implement `export_weekly_deck` with `dry_run`.
- Done when: the generated `.pptx` opens cleanly in PowerPoint, uses the company layouts, and the content matches the DB.

**Phase 3: Remote + dashboard**
- Deploy to Vercel, remote MCP with proper auth, minimal read-only dashboard and share link for the boss.
- Done when: it works as a custom connector in claude.ai and the share link shows current RAG status.

**Phase 4: Career layer**
- Achievement Log, `export_cv_bullets`, Friday reminder (email), multi-workspace switching.

## 10. First actions for Claude Code

1. Create repo skeleton, `README.md` (including the confidentiality warning) and `.gitignore`.
2. Check current MCP SDK docs and pick the server package. Record the choice and version.
3. Write the Supabase migration for section 4 with RLS policies.
4. Implement Phase 1 tools with tests.
5. Ask Hennes for the template before starting Phase 2.
6. Keep a `DECISIONS.md` for every choice made against a "Recommended" default in this file.
