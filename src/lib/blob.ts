// Private Vercel Blob access. Two auth methods, both handled by @vercel/blob itself:
//  1. BLOB_READ_WRITE_TOKEN (read-write token), or
//  2. Vercel OIDC + BLOB_STORE_ID (no token; the OIDC token arrives per request on Vercel, or as VERCEL_OIDC_TOKEN after `vercel env pull`).
// We only add a readable pre-check and error mapping; credentials are never read or logged here.
import { get, issueSignedToken, presignUrl, put } from "@vercel/blob";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const DOWNLOAD_TTL_MS = 10 * 60 * 1000;

/** Blob is not usable (no credentials, or credentials rejected). Message is safe to show. */
export class BlobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobConfigError";
  }
}

export type BlobAuth = "token" | "oidc" | "none";
type Env = Record<string, string | undefined>;

/** Which auth method is available. OIDC needs a store id plus either an OIDC env token or a Vercel runtime (where the token is per request). */
export function blobAuthMode(env: Env = process.env): BlobAuth {
  if (env.BLOB_READ_WRITE_TOKEN) return "token";
  if (env.BLOB_STORE_ID && (env.VERCEL_OIDC_TOKEN || env.VERCEL)) return "oidc";
  return "none";
}

const present = (v: unknown) => (v ? "set" : "missing");

export function notConfiguredMessage(env: Env = process.env): string {
  return (
    "Vercel Blob is not configured: no usable credentials. Use ONE of: " +
    "(1) set BLOB_READ_WRITE_TOKEN (Vercel > Storage > your Blob store > Tokens), or " +
    "(2) keep BLOB_STORE_ID and enable OIDC (Project Settings > Security > Secure Backend Access with OIDC Federation), then redeploy. " +
    `Found: BLOB_READ_WRITE_TOKEN=${present(env.BLOB_READ_WRITE_TOKEN)}, BLOB_STORE_ID=${present(env.BLOB_STORE_ID)}, ` +
    `running on Vercel=${env.VERCEL ? "yes" : "no"}. OIDC only works on Vercel (or after \`vercel env pull\` locally).`
  );
}

export function assertBlobConfigured(env: Env = process.env): BlobAuth {
  const mode = blobAuthMode(env);
  if (mode === "none") throw new BlobConfigError(notConfiguredMessage(env));
  return mode;
}

/** Turn credential/permission failures from the SDK into one actionable message; pass everything else through. */
export function mapBlobError(e: unknown, env: Env = process.env): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/no blob credentials|oidc|unauthorized|forbidden|not authorized|invalid token|access denied|\b40[13]\b/i.test(msg)) {
    return new BlobConfigError(
      `Vercel Blob rejected the credentials (${msg.split("\n")[0].slice(0, 160)}). ${notConfiguredMessage(env)}`,
    );
  }
  return e instanceof Error ? e : new Error(msg);
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  assertBlobConfigured();
  try {
    return await fn();
  } catch (e) {
    throw mapBlobError(e);
  }
}

/** Upload to the PRIVATE store (never public). Returns the stored pathname. */
export function putPrivate(pathname: string, body: Buffer): Promise<{ pathname: string }> {
  return guarded(async () => {
    const b = await put(pathname, body, { access: "private", contentType: PPTX_MIME, addRandomSuffix: true });
    return { pathname: b.pathname };
  });
}

/** 10-minute presigned GET URL for a private blob. */
export function signDownloadUrl(pathname: string, now = Date.now()): Promise<{ url: string; expiresAt: number }> {
  return guarded(async () => {
    const validUntil = now + DOWNLOAD_TTL_MS;
    const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname, access: "private", validUntil });
    return { url: presignedUrl, expiresAt: validUntil };
  });
}

/** Stream a private blob through the server (used by the authenticated download route as a fallback). */
export function readPrivate(pathname: string) {
  return guarded(async () => {
    const r = await get(pathname, { access: "private" });
    return r && r.statusCode === 200 ? { stream: r.stream, size: r.blob.size } : null;
  });
}
