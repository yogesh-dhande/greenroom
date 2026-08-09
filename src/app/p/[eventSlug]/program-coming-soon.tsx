import { EmptyState } from "@/components/empty-state";

/**
 * What an attendee sees on every program surface while the organizer hasn't
 * published yet (decisions.md D-056). Shared by the chrome'd `/p` pages and
 * the chrome-less `/embed` pages so an unpublished event reads the same
 * wherever it's linked or iframed.
 *
 * Says nothing about the schedule itself — not a session count, not a date
 * range beyond what the page already shows — since the whole point is that
 * a half-arranged draft stays private.
 */
export function ProgramComingSoon({ eventName }: { eventName: string }) {
  return (
    <EmptyState
      title="Program coming soon"
      description={`The team is still putting together the ${eventName} program — check back shortly.`}
    />
  );
}
