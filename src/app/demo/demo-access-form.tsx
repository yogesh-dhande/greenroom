"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const personas = [
  {
    id: "organizer",
    label: "Organizer",
    detail: "Full event administration and team management",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    detail: "Track-scoped submissions and assigned scorecards",
  },
  {
    id: "speaker",
    label: "Speaker",
    detail: "Personal portal, profile, sessions, and tasks",
  },
] as const;

type Persona = (typeof personas)[number]["id"];

function tokenFromFragment(fragment: string): string | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  return params.get("token")?.trim() || null;
}

export function DemoAccessForm() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Persona | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fragmentToken = tokenFromFragment(window.location.hash);
    const timer = window.setTimeout(() => {
      setToken(fragmentToken);
      setReady(true);
      // Keep the capability out of copied URLs, screenshots, and later browser
      // navigation. It remains only in this page's in-memory React state.
      // Do this with the state update so React Strict Mode's effect rehearsal
      // cannot erase the fragment before the committed effect captures it.
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function signIn(persona: Persona) {
    if (!token) return;
    setPending(persona);
    setError(null);

    try {
      const response = await fetch("/api/auth/evaluation-login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona, token }),
      });
      if (!response.ok) throw new Error("denied");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(
        "This demo link is invalid, expired, or no longer enabled. Ask the deployment owner for a fresh link.",
      );
      setPending(null);
    }
  }

  if (!ready) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking access…
      </p>
    );
  }

  if (!token) {
    return (
      <p role="alert" className="text-sm text-destructive">
        This page needs the private demo link supplied by the deployment owner.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {personas.map((persona) => (
        <Button
          key={persona.id}
          type="button"
          variant="outline"
          className="h-auto w-full justify-start px-4 py-3 text-left"
          disabled={pending !== null}
          onClick={() => signIn(persona.id)}
        >
          <span className="flex flex-col items-start gap-0.5">
            <span className="font-medium">
              {pending === persona.id ? `Opening ${persona.label}…` : `Sign in as ${persona.label}`}
            </span>
            <span className="whitespace-normal text-xs font-normal text-muted-foreground">
              {persona.detail}
            </span>
          </span>
        </Button>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="pt-2 text-xs text-muted-foreground">
        This private entrance signs in to preconfigured test accounts only. It
        does not create an account or change anyone&apos;s role.
      </p>
    </div>
  );
}
