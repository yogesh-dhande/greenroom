import type { Metadata } from "next";
import Link from "next/link";
import { DemoAccessForm } from "./demo-access-form";

export const metadata: Metadata = {
  title: "Demo access | Greenroom",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

/**
 * Temporary, opt-in competition entrance (D-093). The bearer token lives in
 * the URL fragment, which browsers do not send with this page request. The
 * client removes it from the address bar before presenting any sign-in action.
 */
export default function DemoPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
      <main className="w-full max-w-md">
        <Link
          href="/"
          className="mb-8 inline-block text-sm font-semibold tracking-tight text-foreground"
        >
          Greenroom
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Demo access
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Choose a role to open its existing competition test account. Use a
          separate private window or browser profile for each role.
        </p>
        <DemoAccessForm />
      </main>
    </div>
  );
}
