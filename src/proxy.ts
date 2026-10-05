import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Password gate. Everything except /login and static assets requires the
// signed session cookie. /api/mcp/<secret> is exempt: it has its own secret-path check. (Next 16 renamed middleware to proxy.)
export async function proxy(req: NextRequest) {
  if (await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/mcp/|_next/static|_next/image|favicon.ico).*)"],
};
