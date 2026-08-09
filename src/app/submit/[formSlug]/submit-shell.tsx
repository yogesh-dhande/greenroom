import Link from "next/link";
import type { Submission } from "@/db/entities";
import { closureIsDateDriven, formWindowState, type FormWindow } from "@/domain/forms";
import { formatDeadline } from "@/lib/event-time";

/**
 * The chrome every public CFP page shares — the fresh form, a resumed draft,
 * and the closed/at-limit notices (spec.md §2). Kept in one place so a speaker
 * following an emailed resume link lands on a page that looks like the one
 * they left.
 */
export function SubmitShell({
  eventName,
  formName,
  welcomeCopy,
  children,
}: {
  eventName: string;
  formName: string;
  welcomeCopy?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
      <p className="text-sm text-muted-foreground">{eventName}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{formName}</h1>

      {welcomeCopy ? (
        <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{welcomeCopy}</p>
      ) : null}

      {children}
    </div>
  );
}

/** A bordered message shown where the form would have been. */
export function SubmitNotice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-8 rounded-lg border border-border bg-muted/40 p-8">
      <p className="text-base font-medium text-foreground">{title}</p>
      <div className="mt-2 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/**
 * Tells a signed-in speaker they already have an unfinished draft on this
 * form, without standing in the way of a fresh submission (spec.md §3,
 * D-038). A silently blank form next to a draft nobody mentioned is how a
 * second, duplicate draft gets created — this is a nudge, not the
 * `SubmitNotice` wall the closed/at-limit states use, so the form still
 * renders right below it.
 */
export function DraftResumeNotice({ drafts }: { drafts: Submission[] }) {
  if (drafts.length === 0) return null;
  return (
    <div className="mt-8 rounded-lg border border-warning bg-warning/10 p-4">
      {drafts.length === 1 ? (
        <p className="text-sm text-foreground">
          You have an unfinished draft of this proposal —{" "}
          <Link
            href={`/portal/submissions/${drafts[0].id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            pick up where you left off
          </Link>
          , or start a new one below.
        </p>
      ) : (
        <div className="text-sm text-foreground">
          <p>You have {drafts.length} unfinished drafts on this form:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  href={`/portal/submissions/${draft.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {draft.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2">Finish one of those, or start a new proposal below.</p>
        </div>
      )}
    </div>
  );
}

/**
 * The friendly closed page (spec.md §2, decisions.md D-063) — a submission
 * window that hasn't opened yet, one that has passed, and a form that was
 * never published all read differently, and only the second one ever cites a
 * date.
 *
 * Takes the raw form window rather than a pre-computed state so it always
 * agrees with `formWindowState`/`closureIsDateDriven` — the same guard the
 * portal's read-only banner uses (src/app/portal/submissions/[id]/page.tsx)
 * — instead of a parallel rule that could drift from it.
 */
export function ClosedNotice({ form, timezone }: { form: FormWindow; timezone: string }) {
  const state = formWindowState(form);
  const scheduled = state === "scheduled";
  // An unpublished form can carry a closesAt from a previous publish cycle;
  // citing it would claim the call "closed" on a date it was never open for.
  const dateDriven = closureIsDateDriven(form);
  return (
    <SubmitNotice
      title={
        scheduled
          ? "This call for speakers hasn't opened yet"
          : state === "closed"
            ? "This call for speakers is closed"
            : "This call for speakers isn't open"
      }
    >
      {scheduled && form.opensAt
        ? `Submissions open ${formatDeadline(form.opensAt, timezone)} — come back then.`
        : dateDriven && form.closesAt
          ? `Submissions closed ${formatDeadline(form.closesAt, timezone)}. Thanks for your interest — watch for the next call.`
          : "Submissions aren't being accepted right now. Watch for the next call."}
    </SubmitNotice>
  );
}
