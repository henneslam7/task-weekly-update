// Per-workspace output settings for the team Excel sheet (stored in workspace.brand_config.sheet).
// Date formats use {YYYY} {MM} {M} {DD} {D} placeholders so literal text such as "Target Date" is never mistaken for a token.

export type SheetConfig = {
  sheetName: string;
  /** Planned release date text, e.g. "(Target Date: 11/1/2026)" (US M/D/YYYY, as in the team sheet). */
  targetDateFormat: string;
  /** Delivered release date; written as a real date cell with the matching Excel number format. */
  actualDateFormat: string;
  lastUpdatedFormat: string;
};

export const DEFAULT_SHEET_CONFIG: SheetConfig = {
  sheetName: "Current",
  targetDateFormat: "(Target Date: {M}/{D}/{YYYY})",
  actualDateFormat: "{DD}/{MM}/{YYYY}",
  lastUpdatedFormat: "{DD}/{MM}/{YYYY}",
};

const TOKENS = ["YYYY", "MM", "M", "DD", "D"] as const;

export function assertDateFormat(label: string, fmt: string) {
  const used = [...fmt.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]);
  const bad = used.filter((t) => !(TOKENS as readonly string[]).includes(t));
  if (bad.length) throw new Error(`${label}: unknown placeholder {${bad[0]}}. Use {YYYY} {MM} {M} {DD} {D}.`);
  if (!used.length) throw new Error(`${label}: must contain at least one of {YYYY} {MM} {M} {DD} {D}.`);
}

/** Merge workspace.brand_config.sheet over the defaults; invalid values throw a readable error. */
export function sheetConfigFrom(brand: Record<string, unknown> | null | undefined): SheetConfig {
  const raw = (brand?.sheet ?? {}) as Partial<SheetConfig>;
  const cfg: SheetConfig = { ...DEFAULT_SHEET_CONFIG };
  for (const k of Object.keys(DEFAULT_SHEET_CONFIG) as (keyof SheetConfig)[]) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") throw new Error(`brand_config.sheet.${k} must be a string`);
    cfg[k] = v;
  }
  assertDateFormat("targetDateFormat", cfg.targetDateFormat);
  assertDateFormat("actualDateFormat", cfg.actualDateFormat);
  assertDateFormat("lastUpdatedFormat", cfg.lastUpdatedFormat);
  if (/[\\/:*?\[\]]/.test(cfg.sheetName) || cfg.sheetName.length > 31) {
    throw new Error("sheetName must be at most 31 characters and not contain / \\ : * ? [ ]");
  }
  return cfg;
}

export function formatIso(iso: string, fmt: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const two = (n: number) => String(n).padStart(2, "0");
  return fmt
    .replace(/\{YYYY\}/g, String(y))
    .replace(/\{MM\}/g, two(m))
    .replace(/\{M\}/g, String(m))
    .replace(/\{DD\}/g, two(d))
    .replace(/\{D\}/g, String(d));
}

/** Excel number format for a date-only placeholder format, e.g. "{DD}/{MM}/{YYYY}" -> "dd/mm/yyyy". */
export function excelNumFmt(fmt: string): string {
  return fmt
    .replace(/\{YYYY\}/g, "yyyy")
    .replace(/\{MM\}/g, "mm")
    .replace(/\{M\}/g, "m")
    .replace(/\{DD\}/g, "dd")
    .replace(/\{D\}/g, "d");
}

/** Calendar date (YYYY-MM-DD) of an instant in the given IANA timezone. */
export function isoDateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
