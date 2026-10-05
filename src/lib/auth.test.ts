import { beforeAll, describe, expect, it } from "vitest";
import {
  checkPassword,
  clearFailures,
  createSessionToken,
  isRateLimited,
  recordFailure,
  verifySessionToken,
} from "./auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "x".repeat(40);
});

describe("auth", () => {
  it("compares passwords", () => {
    expect(checkPassword("hunter2", "hunter2")).toBe(true);
    expect(checkPassword("hunter3", "hunter2")).toBe(false);
    expect(checkPassword("", "hunter2")).toBe(false);
    expect(checkPassword("anything", "")).toBe(false);
  });
  it("signs and verifies sessions, rejects tampering", async () => {
    const t = await createSessionToken();
    expect(await verifySessionToken(t)).toBe(true);
    expect(await verifySessionToken(t.slice(0, -2) + "xx")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
  });
  it("rate limits after 5 failures and resets after the window", () => {
    const k = "1.2.3.4";
    clearFailures(k);
    for (let i = 0; i < 5; i++) recordFailure(k, 1000);
    expect(isRateLimited(k, 2000)).toBe(true);
    expect(isRateLimited(k, 1000 + 16 * 60 * 1000)).toBe(false);
  });
});
