import { NextResponse } from "next/server";
import { exportWeeklyDeck, ExportError } from "@/lib/services";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** POST { weekStart?: "YYYY-MM-DD", dryRun?: boolean } -> ExportResult (password gate applies via proxy). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { weekStart?: string; dryRun?: boolean };
  try {
    const r = await exportWeeklyDeck(body.weekStart || undefined, { dryRun: !!body.dryRun });
    return NextResponse.json(r);
  } catch (e) {
    const known = e instanceof ExportError || (e instanceof Error && /week_start|Monday/i.test(e.message));
    if (!known) console.error("export failed", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: known ? (e as Error).message : "Export failed unexpectedly. See server logs." },
      { status: known ? 422 : 500 },
    );
  }
}
