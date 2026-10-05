import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { logoutAction } from "./actions";
import "./globals.css";

export const metadata: Metadata = { title: "Weekly Portal", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const links = [
  ["/", "Dashboard"],
  ["/requests", "Requests"],
  ["/achievements", "Achievements"],
  ["/summary", "Week summary"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await cookies()).has("session");
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {signedIn && (
          <header className="border-b bg-white">
            <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
              {links.map(([href, label]) => (
                <Link key={href} href={href} className="font-medium text-slate-700 hover:text-slate-950">
                  {label}
                </Link>
              ))}
              <form action={logoutAction} className="ml-auto">
                <button className="text-slate-500 hover:text-slate-900">Sign out</button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
