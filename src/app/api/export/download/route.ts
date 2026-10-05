import { NextResponse } from "next/server";
import { BlobConfigError, readPrivate } from "@/lib/blob";
import { ExportError, getRunFile, signDownloadUrl } from "@/lib/services";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET ?run=<export_run id>. Behind the password gate (proxy). Redirects to a fresh 10-minute presigned URL of the
 * PRIVATE blob; if signing is unavailable it streams the file through this authenticated route instead.
 */
export async function GET(req: Request) {
  const run = new URL(req.url).searchParams.get("run") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(run)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  try {
    const { pathname, name } = await getRunFile(run);
    try {
      return NextResponse.redirect((await signDownloadUrl(pathname)).url, 302);
    } catch (e) {
      if (e instanceof BlobConfigError) throw e;
      // signing failed for another reason: fall back to streaming
    }
    const f = await readPrivate(pathname);
    if (!f) return NextResponse.json({ error: "File not found in Blob storage" }, { status: 404 });
    return new Response(f.stream, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`,
        "cache-control": "private, no-store",
        "content-length": String(f.size),
      },
    });
  } catch (e) {
    if (e instanceof ExportError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BlobConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error("download failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not create download link" }, { status: 500 });
  }
}
