import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

/** Constant-time compare: hash both sides so lengths always match. */
export function checkPassword(input: string, expected = process.env.APP_PASSWORD): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

// Simple in-memory limiter: 5 failures per 15 min per key. On serverless each
// instance has its own memory, so this is best-effort, not a hard guarantee.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const fails = new Map<string, { count: number; first: number }>();

export function isRateLimited(key: string, now = Date.now()): boolean {
  const e = fails.get(key);
  if (!e) return false;
  if (now - e.first > WINDOW_MS) {
    fails.delete(key);
    return false;
  }
  return e.count >= MAX_FAILS;
}

export function recordFailure(key: string, now = Date.now()): void {
  const e = fails.get(key);
  if (!e || now - e.first > WINDOW_MS) fails.set(key, { count: 1, first: now });
  else e.count += 1;
}

export function clearFailures(key: string): void {
  fails.delete(key);
}
