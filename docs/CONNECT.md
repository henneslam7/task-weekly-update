# Connect Claude to the portal (MCP)

The portal exposes an MCP server at `https://<app>.vercel.app/api/mcp/<MCP_SECRET>`.

**The URL is the credential.** There is no OAuth and no other login on this endpoint. Anyone who has the full URL can read and write your weekly-update data. Do not paste it into chats you share, screenshots, tickets or git. If it leaks, change `MCP_SECRET` (below) and re-add the connector. A wrong or missing secret returns 404; if `MCP_SECRET` is unset the endpoint is disabled.

## 1. Generate and set MCP_SECRET

```bash
openssl rand -hex 32
```

Add the output as env var `MCP_SECRET` in Vercel (Project > Settings > Environment Variables, Production, then redeploy). For local dev put it in `.env.local`. Rotating = generate a new value, update Vercel, redeploy, update the connector URL.

## 2. claude.ai (web / desktop / mobile)

1. Settings > Connectors > **Add custom connector**.
2. Name: `Weekly portal`. URL: `https://<app>.vercel.app/api/mcp/<MCP_SECRET>`.
3. Leave any OAuth / advanced fields empty. Click Add.
4. In a chat, enable the connector from the tools menu. Ask "list my projects" to test.

## 3. Claude Code

```bash
claude mcp add --transport http portal https://<app>.vercel.app/api/mcp/<MCP_SECRET>
claude mcp list
```

Add `--scope user` to make it available in every project.

## Tools

`list_projects`, `upsert_project`, `log_weekly_update`, `get_week_summary`, `list_missing_updates`, `log_request`, `add_achievement`, `export_markdown`, `export_cv_bullets`, `export_weekly_deck`. Writes are idempotent and return the saved record. `week_start` must be a Monday; omit it for the default week (the previous week when called on a Monday). Project names are matched loosely.

## Weekly routine (paste into a Claude Project's instructions)

```text
You help me with my weekly update using the "portal" connector. Timezone Asia/Hong_Kong, English.
When I give you updates, log them with log_weekly_update / log_request / add_achievement
(match project names loosely, ask only if ambiguous).
Every Monday:
1. Call list_missing_updates and ask me about each project listed.
2. Log my answers, then call get_week_summary and show me a short draft
   (wins, status per project, requests, blockers).
3. Wait for me to confirm or edit. Never export before I confirm.
4. Call export_weekly_deck and give me the download link.
For email/Slack use export_markdown instead. Never invent data; if a field is unknown, leave it out.
```
