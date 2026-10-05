import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDb, schema, type Db } from "../db";
import { GET, POST, DELETE } from "@/app/api/mcp/[secret]/route";
import { checkMcpSecret } from "./secret";

const SECRET = "s3cret-test-value-0123456789abcdef";
let pg: PGlite;

beforeAll(async () => {
  process.env.MCP_SECRET = SECRET;
  pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  setDb(db as unknown as Db);
});
afterAll(() => {
  delete process.env.MCP_SECRET;
});
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE achievement, request_log, weekly_update, export_run, file, project RESTART IDENTITY CASCADE",
  );
});

const url = (s: string) => `http://localhost/api/mcp/${s}`;
let rpcId = 0;
function post(secret: string, method: string, params: unknown) {
  return POST(
    new Request(url(secret), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
    { params: Promise.resolve({ secret }) },
  );
}

/** Parse a JSON or SSE (`data: {...}`) JSON-RPC response body. */
async function rpc(res: Response) {
  const body = await res.text();
  const line = body.startsWith("{") ? body : body.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
  return JSON.parse(line);
}

async function call(name: string, args: Record<string, unknown>) {
  const res = await post(SECRET, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const msg = await rpc(res);
  if (msg.error) return { rpcError: msg.error as { message: string } };
  const r = msg.result as { isError?: boolean; content: { text: string }[] };
  return { isError: !!r.isError, text: r.content[0].text };
}

describe("secret path auth", () => {
  it("accepts only the exact secret", () => {
    expect(checkMcpSecret(SECRET)).toBe(true);
    expect(checkMcpSecret(SECRET + "x")).toBe(false);
    expect(checkMcpSecret("")).toBe(false);
    expect(checkMcpSecret(undefined)).toBe(false);
  });
  it("is disabled when MCP_SECRET is unset or empty", () => {
    expect(checkMcpSecret("anything", undefined)).toBe(false);
    expect(checkMcpSecret("", "")).toBe(false);
  });
  it("returns 404 for wrong secret on every method", async () => {
    const ctx = { params: Promise.resolve({ secret: "nope" }) };
    for (const [fn, method] of [[GET, "GET"], [POST, "POST"], [DELETE, "DELETE"]] as const) {
      const res = await fn(new Request(url("nope"), { method, body: method === "POST" ? "{}" : undefined }), ctx);
      expect(res.status).toBe(404);
    }
  });
  it("returns 404 when MCP_SECRET is unset", async () => {
    delete process.env.MCP_SECRET;
    try {
      const res = await post(SECRET, "tools/list", {});
      expect(res.status).toBe(404);
    } finally {
      process.env.MCP_SECRET = SECRET;
    }
  });
  it("proxy matcher exempts /api/mcp but not other API paths", async () => {
    const { config } = await import("@/proxy");
    const re = new RegExp("^" + config.matcher[0] + "$");
    expect(re.test("/api/mcp/abc")).toBe(false);
    expect(re.test("/")).toBe(true);
    expect(re.test("/summary")).toBe(true);
  });
});

describe("tools via the route", () => {
  it("lists the tools", async () => {
    const msg = await rpc(await post(SECRET, "tools/list", {}));
    const names = msg.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_projects", "upsert_project", "log_weekly_update", "get_week_summary",
        "list_missing_updates", "log_request", "add_achievement", "export_markdown", "export_cv_bullets",
      ]),
    );
  });

  it("runs the weekly flow with idempotent writes and fuzzy project match", async () => {
    const p1 = await call("upsert_project", { name: "ST sub-domain", priority: "P1" });
    expect(JSON.parse(p1.text!).name).toBe("ST sub-domain");
    await call("upsert_project", { name: "PPL Pass" });
    const again = await call("upsert_project", { name: "st SUB-domain", progress_pct: 40 });
    expect(JSON.parse(again.text!).progressPct).toBe(40);
    expect(JSON.parse((await call("list_projects", {})).text!)).toHaveLength(2);

    const a = await call("log_weekly_update", { project: "ST sub", week_start: "2026-09-28", progress: "Wireframe done", rag: "green" });
    const b = await call("log_weekly_update", { project: "st sub-domain", week_start: "2026-09-28", wins: "Approved" });
    const ra = JSON.parse(a.text!), rb = JSON.parse(b.text!);
    expect(rb.id).toBe(ra.id);
    expect(rb.progress).toBe("Wireframe done");

    const missing = JSON.parse((await call("list_missing_updates", { week_start: "2026-09-28" })).text!);
    expect(missing.projects.map((p: { name: string }) => p.name)).toEqual(["PPL Pass"]);

    await call("log_request", { from_person: "Amy", summary: "Banner", outcome: "redirected", redirected_to: "Nicholas", received_on: "2026-09-29" });
    await call("add_achievement", { title: "Faster site", what_was_done: "Optimised images", metric: "LCP -40%", achieved_on: "2026-09-30" });

    const sum = JSON.parse((await call("get_week_summary", { week_start: "2026-09-28" })).text!);
    expect(sum.requests).toHaveLength(1);
    expect(sum.achievements).toHaveLength(1);
    expect((await call("export_markdown", { week_start: "2026-09-28" })).text).toContain("Wireframe done");
    expect((await call("export_cv_bullets", {})).text).toBe("- Faster site: Optimised images (LCP -40%)");
  });
});

describe("readable errors", () => {
  it("rejects a non-Monday week_start", async () => {
    const r = await call("get_week_summary", { week_start: "2026-10-07" });
    const msg = r.rpcError?.message ?? r.text ?? "";
    expect(msg).toMatch(/Monday/);
    expect(msg).not.toMatch(/\n\s+at /);
  });
  it("reports unknown and ambiguous projects readably", async () => {
    await call("upsert_project", { name: "Alpha One" });
    await call("upsert_project", { name: "Alpha Two" });
    const missing = await call("log_weekly_update", { project: "Zeta", progress: "x" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not found.*Alpha One/);
    const amb = await call("log_weekly_update", { project: "Alpha", progress: "x" });
    expect(amb.isError).toBe(true);
    expect(amb.text).toMatch(/ambiguous/);
  });
  it("requires redirected_to for redirected requests", async () => {
    const r = await call("log_request", { from_person: "A", summary: "B", outcome: "redirected" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/redirectedTo/);
  });
});
