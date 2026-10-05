import { NextResponse } from "next/server";
import { ExportError, getRunDownloadUrl } from "@/lib/services";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** GET ?run=<export_run id> -> 302 to a fresh 10-minute presigned URL. */
export async function GET(req: Request) {
  const run = new URL(req.url).searchParams.get("run") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(run)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  try {
    return NextResponse.redirect(await getRunDownloadUrl(run), 302);
  } catch (e) {
    if (e instanceof ExportError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("download failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not create download link" }, { status: 500 });
  }
}
