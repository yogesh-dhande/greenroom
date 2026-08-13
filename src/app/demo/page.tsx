import type { Metadata } from "next";
import Link from "next/link";
import { DemoAccessForm } from "./demo-access-form";

export const metadata: Metadata = {
  title: "Demo access | Greenroom",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Public, temporary entrance to three fixed demo personas (D-093). */
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
          Choose a role to open its existing test account. Use a
          separate private window or browser profile for each role.
        </p>
        <DemoAccessForm />
      </main>
    </div>
  );
}
