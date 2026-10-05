import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of the path secret against env MCP_SECRET.
 * Unset/empty MCP_SECRET disables the endpoint (always false). Never logs.
 */
export function checkMcpSecret(candidate: string | undefined, expected = process.env.MCP_SECRET): boolean {
  if (!expected || !candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
