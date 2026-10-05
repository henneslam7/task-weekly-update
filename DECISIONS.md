# DECISIONS (verified 2026-10-05)

Versions are npm `latest` as of today (checked via `npm view`). "Unverified" = could not fetch the primary page (vercel.com, better-auth.com, modelcontextprotocol.io and singerla.github.io are blocked by the sandbox egress proxy); those facts come from search snippets / package READMEs.

## Decision table

| # | Decision | Choice | Version | Why | Source |
|---|----------|--------|---------|-----|--------|
| 1 | MCP server lib | `mcp-handler` + `@modelcontextprotocol/server` (v2 SDK) + `zod` | mcp-handler 2.2.0, @modelcontextprotocol/server 2.3.0, zod 4.6.5 | mcp-handler 2.x is Vercel's Next.js adapter; peer dep is `@modelcontextprotocol/server ^2`; serves spec 2026-07-28 and stays backward compatible with 2025-era Streamable HTTP clients; gives `withMcpAuth` + `protectedResourceHandler` (RFC 9728) so we write no 401/metadata plumbing. v2 SDK is the stable line. Old monolithic `@modelcontextprotocol/sdk` (1.32.0) is still maintained but is NOT a peer of mcp-handler 2.x. | https://github.com/vercel/mcp-handler , https://www.npmjs.com/package/@modelcontextprotocol/server |
| 2 | Route | `app/api/mcp/route.ts`, `export { handler as GET, handler as POST }`, wrapped in `withMcpAuth` | - | Per README example; tools use `registerTool` + `inputSchema: z.object(...)`; auth info at `ctx.http?.authInfo` | https://github.com/vercel/mcp-handler |
| 3 | Auth server | Better Auth as OAuth 2.1 AS inside the same Next.js app, GitHub social login, single-user gate | better-auth 1.7.7, @better-auth/oauth-provider 1.7.7, @better-auth/mcp 1.7.7 | claude.ai web needs a real OAuth AS (see section "Auth design"). GitHub itself is not a DCR/CIMD AS, so we need a facade; Better Auth ships it (DCR via `allowDynamicClientRegistration`, `cimd`, consent/login page hooks, PKCE, refresh rotation). | https://www.npmjs.com/package/@better-auth/mcp , https://claude.com/docs/connectors/building/authentication |
| 4 | Claude Code auth | Static bearer token (`MCP_STATIC_TOKEN`, 32+ random bytes) accepted by `verifyToken` next to OAuth access tokens; constant-time compare of SHA-256 hashes | - | Claude Code accepts a static header; claude.ai web does not (static headers are beta, limited orgs). Claude Code can also do OAuth via loopback, so the token is optional convenience. | https://claude.com/docs/connectors/building/authentication , https://claude.com/docs/connectors/custom/remote-mcp |
| 5 | DB | Neon Postgres via Vercel Marketplace | `@neondatabase/serverless` 1.2.0 | Marketplace injects `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), legacy `POSTGRES_URL*`, `PG*`. Use `DATABASE_URL` at runtime (`neon()` HTTP driver; `Pool` only when a transaction is needed), `DATABASE_URL_UNPOOLED` for migrations. | https://neon.com/docs/guides/neon-managed-vercel-integration |
| 6 | ORM / migrations | Drizzle ORM + drizzle-kit (generated SQL files committed, applied with `drizzle-kit migrate` in CI/locally, NOT at request time) | drizzle-orm 0.45.3, drizzle-kit 0.31.11 | Better Auth has a first-class Drizzle adapter and can generate its own schema (`@better-auth/cli generate`); one migration tool for both app and auth tables beats plain SQL. Tables stay tiny. | https://www.npmjs.com/package/drizzle-orm |
| 7 | Files | Vercel Blob, PRIVATE store (`access: 'private'`), env `BLOB_READ_WRITE_TOKEN` (or OIDC on Vercel) | @vercel/blob 2.8.0 | Template + exported decks are company material: never public. Time-limited download = `issueSignedToken({pathname, operations:['get'], validUntil})` then `presignUrl(token,{operation:'get',pathname,access:'private',validUntil: now+10min})`. Token max 7 days, default 1 h; cache the issued token. | https://vercel.com/docs/vercel-blob/vercel-signed-urls , https://vercel.com/docs/vercel-blob/private-storage |
| 8 | Upload path for the template | Client upload (browser -> Blob) or one-off script; never through a function body | - | Function request AND response bodies are capped at 4.5 MB. Server `put()` of the generated pptx is fine (no request body); return a presigned URL, never stream the deck through the function. | https://vercel.com/docs/functions/limitations (search snippet) |
| 9 | Function limits (Hobby, Fluid compute) | Set `export const maxDuration = 60` on export route (cap is 300 s); memory up to 2 GB / 1 vCPU | Next 16.3.8 | pptx-automizer is pure JS, zip in memory; a 20-slide deck should render in seconds. Hobby memory/duration per search results; not verified on the primary page. | https://vercel.com/docs/functions/limitations , https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute |
| 10 | pptx export | `pptx-automizer` (Node). python-pptx only as fallback | 0.9.4 (2026-09-28), Node >=20 | Deps are pure JS (jszip, pptxgenjs, @xmldom/xmldom, slugify): no native binaries, fine on Vercel. Loads root template, `addSlide(label, n, cb)` copies a template slide with its original master/layout (`autoImportSlideMasters: true`), `slide.modifyElement('ShapeName', [modify.setText(..)])`. Native tables via `modify.setTable`; native charts via `modify.setChartData`. | https://www.npmjs.com/package/pptx-automizer (README + bundled AI-INSTRUCTOR.md, CHANGELOG.md) |
| 11 | Week rule | see "week_start rule" | - | - | - |

## Auth design (one user, simplest secure)

What claude.ai custom connectors require today (https://claude.com/docs/connectors/building/authentication):
- Supported types: OAuth with DCR, OAuth with CIMD (both default), Anthropic-held creds / custom_connection (by contacting Anthropic), `static_headers` (beta, limited orgs, may not appear in our dialog), and `none`.
- claude.ai web dialog: if static headers are not available, only OAuth or authless. Authless on a personal data server = unacceptable.
- Needs: `401` + `WWW-Authenticate: Bearer resource_metadata="..."` (a 401 is mandatory), RFC 9728 protected-resource doc whose `resource` equals the connector URL exactly, first `authorization_servers` entry used, RFC 8414 AS metadata, S256 PKCE, `/token` accepting `application/x-www-form-urlencoded`, refresh-token rotation for public clients, `invalid_grant` errors, discovery/token endpoints answer within 10 s (refresh 30 s).
- Redirect URIs to allow: `https://claude.ai/api/mcp/auth_callback`; for Claude Code, loopback `http://localhost/callback` and `http://127.0.0.1/callback` with port ignored.
- CIMD is used only if AS metadata advertises `client_id_metadata_document_supported: true` AND `"none"` in `token_endpoint_auth_methods_supported`; else DCR (`registration_endpoint`). MCP spec 2026-07-28 deprecates DCR in favor of CIMD. Enable BOTH.
- Anthropic egress IPs: 160.79.104.0/21 (do not block with a WAF rule).

Design:
1. Next.js app hosts everything on one origin (e.g. `https://<app>.vercel.app`): `/api/mcp` (resource), `/api/auth/*` (Better Auth + oauth-provider), `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (root-level routes; Next route files, plus path-suffixed variant for `/api/mcp`).
2. Login = GitHub OAuth app (callback `https://<app>/api/auth/callback/github`). Env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_GITHUB_USERNAME`.
3. Single-user gate (we write this): Better Auth `databaseHooks.user.create.before` and `session.create.before` reject unless the GitHub `login` (from the account profile, case-insensitive) equals `ALLOWED_GITHUB_USERNAME`; also check immutable numeric GitHub id (`ALLOWED_GITHUB_ID`) to survive username changes/reuse. Disable email/password signup. The OAuth consent page auto-approves for that user (single user, still shows redirect hostname per spec).
4. `verifyToken` (we write): (a) if token equals static token hash -> `{clientId:'claude-code-static', scopes:['mcp']}`; (b) else verify the access token via Better Auth/oauth-provider (JWT with `jose` against JWKS, audience = MCP resource URL, `exp`). Anything else -> undefined (401).
5. Implement ourselves: gate hooks, `verifyToken`, protected-resource route, consent page, rate limit on `/api/mcp` and `/register`, tool-level `workspace_id` resolution (single constant workspace). Library does: DCR/CIMD, authorize/token/jwks/metadata endpoints, PKCE, refresh rotation.
6. Alternative if Better Auth friction: `@modelcontextprotocol` v2 serving guide covers auth too, but ships no AS; hand-rolling an AS is more code. Rejected.

## Data model (final, every table has `workspace_id`)

Better Auth tables (generated, no workspace_id; single user): `user`, `session`, `account`, `verification`, `oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`, `jwks` (exact names per generator).

App tables:
1. `workspace` (id, name, owner_github_id, created_at) - one row; `workspace_id` FK target.
2. `project` (id, workspace_id, name, status, created_at)
3. `weekly_update` (id, workspace_id, week_start date, project_id null, kind enum `progress|task|blocker|request|achievement`, title, detail, status `open|done|blocked`, due_date null, created_at, updated_at) - tasks and blockers merged here via `kind`/`status`.
4. `file` (id, workspace_id, blob_pathname, kind `template|export`, original_name, bytes, week_start null, created_at)
5. `export_run` (id, workspace_id, week_start, file_id, status, error, created_at)
6. `template_map` (id, workspace_id, file_id, slide_no, shape_name, field) - maps template slide/shape names to data fields.
No RLS: all queries go through one `db` helper that injects the constant `workspace_id`; auth is the single gate.

## week_start rule

Timezone `WEEK_TZ` env, default `Asia/Hong_Kong` (ASSUMPTION: user works at Plaza Premium Group, HK; confirm). Let `now` be local time in `WEEK_TZ`, `isoDow` 1=Mon..7=Sun, `monday(d) = date(d) - (isoDow(d)-1) days`.
- If `isoDow(now) == 1` (Monday, ANY time of day): `week_start = monday(now) - 7 days` (the week that just ended; the Monday-noon deadline is for it, late runs still target it).
- Else: `week_start = monday(now)`.
- Explicit `week_start` argument overrides, must be a Monday (reject otherwise). Week = `week_start` 00:00 to `week_start+6` 23:59:59 local. Store as `date`, never timestamp. Unit-test Sun 23:59, Mon 00:00, Mon 11:59, Mon 12:00, Tue.

## Rendering previews
`which soffice` -> `/usr/bin/soffice` (and `/usr/bin/libreoffice`) EXIST in this sandbox: use `soffice --headless --convert-to pdf` then `pdftoppm` for visual QA. Not available on Vercel; previews are dev-time only.

## Open risks
1. claude.ai custom-connector OAuth against our own AS is the highest-risk piece: DCR vs CIMD negotiation, exact `resource` match, 10 s endpoint limit, cold starts. Test early with a stub before building tools.
2. Spec/SDK churn: MCP spec 2026-07-28 and SDK v2 are new (2.3.0 published 2026-10-02); pin exact versions, no `^`.
3. Better Auth oauth-provider API surface (1.7.x) was verified only from package typings and search snippets; better-auth.com docs were blocked. Prototype first; fallback is hand-rolled AS.
4. Static token header for claude.ai is beta/limited; do not rely on it. Claude Code header form: `claude mcp add --transport http portal <url> --header "Authorization: Bearer <token>"` (not re-verified this session).
5. pptx-automizer is add-only (builds from root template + copied slides); template must use native tables/charts and uniquely named shapes (Selection Pane); grouped "fake tables" cannot use `setTable`; chart title/plot-area edits need manual-edited elements. Needs a real-template spike (also check fonts: LibreOffice previews may differ from PowerPoint). Docs site singerla.github.io was blocked; limits taken from bundled AI-INSTRUCTOR.md.
6. Vercel limits (Hobby 300 s/2 GB, 4.5 MB body, Blob 1 GB Hobby) came from search snippets; Hobby Blob quota reportedly raised recently, re-check dashboard. Hobby is non-commercial use: check employer/IT policy (README already warns).
7. Neon free-tier cold start (~sub-second to seconds) adds latency to token endpoint; keep under 10 s.
8. Confidentiality: template is company property in a personal Blob store; keep store private, short-lived URLs, no logs of content.
9. Preview deployments get Neon branches with NOLOGIN roles for preview URLs (community report); migrations should target `DATABASE_URL_UNPOOLED` on production.

## Deviations from HANDOVER.md
`HANDOVER.md` does NOT exist in the repo (only README.md, which references it), so no line-by-line comparison was possible. Deviations from the brief/README assumptions:
- Auth is OAuth-based, not a simple bearer, for claude.ai (static headers are beta/limited); bearer kept only for Claude Code.
- Official SDK is v2 `@modelcontextprotocol/server`, not `@modelcontextprotocol/sdk`.
- task and blocker merged into `weekly_update` (`kind`/`status`); Supabase RLS dropped; `workspace_id` kept everywhere (except Better Auth's own tables).
- Added `template_map` and `export_run` tables; added Better Auth tables.
- Generated deck delivered via presigned Blob URL, not streamed through a function (4.5 MB cap).
