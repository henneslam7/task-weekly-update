import { describe, expect, it } from "vitest";
import { addDays, currentWeekStart, resolveWeekStart, weekEnd } from "./week";

const TZ = "Asia/Hong_Kong"; // UTC+8, no DST
// Helper: build an instant from an HK local wall-clock time.
const hk = (iso: string) => new Date(`${iso}+08:00`);

// 2026-10-05 is a Monday. Previous Monday is 2026-09-28.
describe("currentWeekStart (Asia/Hong_Kong)", () => {
  it("Sun 23:59 -> Monday of that same week", () => {
    expect(currentWeekStart(hk("2026-10-04T23:59:00"), TZ)).toBe("2026-09-28");
  });
  it("Mon 00:00 -> previous week", () => {
    expect(currentWeekStart(hk("2026-10-05T00:00:00"), TZ)).toBe("2026-09-28");
  });
  it("Mon 11:59 -> previous week", () => {
    expect(currentWeekStart(hk("2026-10-05T11:59:00"), TZ)).toBe("2026-09-28");
  });
  it("Mon 12:00 -> still previous week (any time Monday)", () => {
    expect(currentWeekStart(hk("2026-10-05T12:00:00"), TZ)).toBe("2026-09-28");
  });
  it("Tue -> this Monday", () => {
    expect(currentWeekStart(hk("2026-10-06T09:00:00"), TZ)).toBe("2026-10-05");
  });
  it("uses the tz, not UTC: Sun 20:00 UTC is already Mon in HK", () => {
    expect(currentWeekStart(new Date("2026-10-04T20:00:00Z"), TZ)).toBe("2026-09-28");
    expect(currentWeekStart(new Date("2026-10-04T20:00:00Z"), "UTC")).toBe("2026-09-28");
    expect(currentWeekStart(new Date("2026-10-05T01:00:00Z"), "America/Los_Angeles")).toBe("2026-09-28");
  });
});

describe("resolveWeekStart", () => {
  it("accepts an explicit Monday", () => {
    expect(resolveWeekStart("2026-10-05", hk("2026-10-08T10:00:00"), TZ)).toBe("2026-10-05");
  });
  it("rejects a non-Monday", () => {
    expect(() => resolveWeekStart("2026-10-06", new Date(), TZ)).toThrow(/Monday/);
  });
  it("rejects malformed dates", () => {
    expect(() => resolveWeekStart("2026-02-30", new Date(), TZ)).toThrow();
    expect(() => resolveWeekStart("nope", new Date(), TZ)).toThrow();
  });
  it("falls back to the rule when omitted", () => {
    expect(resolveWeekStart(undefined, hk("2026-10-08T10:00:00"), TZ)).toBe("2026-10-05");
  });
});

describe("date helpers", () => {
  it("weekEnd is Sunday", () => expect(weekEnd("2026-10-05")).toBe("2026-10-11"));
  it("addDays crosses month/year", () => expect(addDays("2026-12-31", 1)).toBe("2027-01-01"));
});
