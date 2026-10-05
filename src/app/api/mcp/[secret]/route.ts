import { createMcpHandler } from "mcp-handler";
import { checkMcpSecret } from "@/lib/mcp/secret";
import { registerTools } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

// Authless MCP: the secret in the URL path is the credential (see docs/CONNECT.md).
// Wrong or missing secret -> plain 404, indistinguishable from "no such route".
const mcp = createMcpHandler(registerTools, { serverInfo: { name: "weekly-update-portal", version: "0.1.0" } });

type Ctx = { params: Promise<{ secret: string }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { secret } = await ctx.params;
  if (!checkMcpSecret(secret)) return new Response("Not found", { status: 404 });
  return mcp(req);
}

export { handle as GET, handle as POST, handle as DELETE };
