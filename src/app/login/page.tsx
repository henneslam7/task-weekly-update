import { loginAction } from "../actions";
import { btnCls, inputCls } from "@/components/ui";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border bg-white p-6">
      <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
      <form action={loginAction} className="space-y-3">
        <input
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          className={inputCls}
        />
        {error === "invalid" && <p className="text-sm text-red-700">Wrong password.</p>}
        {error === "locked" && <p className="text-sm text-red-700">Too many attempts. Try again in 15 minutes.</p>}
        <button className={`${btnCls} w-full`}>Sign in</button>
      </form>
    </div>
  );
}
