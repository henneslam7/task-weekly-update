/**
 * week_start rule (DECISIONS.md, updated 2026-10-16: the team reports every Friday by 12pm):
 * the default week is always the Mon-Sun week that contains "now" (Mon-Fri while updating, Sat/Sun still the week
 * just reported). Nothing special happens on Monday. Dates are plain "YYYY-MM-DD" strings (Postgres `date`).
 */
export const DEFAULT_TZ = "Asia/Hong_Kong";

export function weekTz(): string {
  return process.env.WEEK_TZ || DEFAULT_TZ;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Local calendar date and ISO weekday (1=Mon..7=Sun) of an instant in tz. */
export function localDate(now: Date, tz: string = weekTz()): { ymd: string; isoDow: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const isoDow = WEEKDAYS.indexOf(get("weekday")) + 1;
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, isoDow };
}

function parseYmd(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Invalid date "${ymd}", expected YYYY-MM-DD`);
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid date "${ymd}"`);
  }
  return dt;
}

export function addDays(ymd: string, days: number): string {
  const dt = parseYmd(ymd);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function isMonday(ymd: string): boolean {
  return parseYmd(ymd).getUTCDay() === 1;
}

/** Today's local date (YYYY-MM-DD) in tz. */
export function todayLocal(now: Date = new Date(), tz: string = weekTz()): string {
  return localDate(now, tz).ymd;
}

export function currentWeekStart(now: Date = new Date(), tz: string = weekTz()): string {
  const { ymd, isoDow } = localDate(now, tz);
  return addDays(ymd, -(isoDow - 1));
}

/** The Friday of the week (the team sheet's "Week ending (Friday)"). */
export function weekEndingFriday(weekStart: string): string {
  return addDays(weekStart, 4);
}

/** Explicit week_start must be a Monday; otherwise fall back to the rule. */
export function resolveWeekStart(
  explicit?: string | null,
  now: Date = new Date(),
  tz: string = weekTz(),
): string {
  if (explicit) {
    if (!isMonday(explicit)) throw new Error(`week_start must be a Monday, got ${explicit}`);
    return explicit;
  }
  return currentWeekStart(now, tz);
}

export function weekEnd(weekStart: string): string {
  return addDays(weekStart, 6);
}
