import { NextResponse } from "next/server";
import { exportWeeklySheet, ExportError } from "@/lib/services";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** POST { weekStart?, owner?, dryRun? } -> SheetExportResult (password gate applies via proxy). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { weekStart?: string; owner?: string; dryRun?: boolean };
  try {
    return NextResponse.json(
      await exportWeeklySheet(body.weekStart || undefined, { owner: body.owner || undefined, dryRun: !!body.dryRun }),
    );
  } catch (e) {
    const known = e instanceof ExportError || (e instanceof Error && /week_start|Monday/i.test(e.message));
    if (!known) console.error("sheet export failed", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: known ? (e as Error).message : "Export failed unexpectedly. See server logs." },
      { status: known ? 422 : 500 },
    );
  }
}
