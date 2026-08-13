"use client";

import { useState } from "react";
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

export function DemoAccessForm() {
  const router = useRouter();
  const [pending, setPending] = useState<Persona | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(persona: Persona) {
    setPending(persona);
    setError(null);

    try {
      const response = await fetch("/api/auth/evaluation-login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      if (!response.ok) throw new Error("denied");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(
        "Demo access is unavailable or has expired. You can still sign in with your own email.",
      );
      setPending(null);
    }
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
        Demo access signs in to preconfigured test accounts only. It
        does not create an account or change anyone&apos;s role.
      </p>
    </div>
  );
}
