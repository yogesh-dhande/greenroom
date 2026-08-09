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

/** The friendly closed page (spec.md §2 — a submission window that has not
 * opened yet reads very differently from one that has passed). */
export function ClosedNotice({
  state,
  opensAt,
  closesAt,
  timezone,
}: {
  state: string;
  opensAt: Date | null;
  closesAt: Date | null;
  timezone: string;
}) {
  const scheduled = state === "scheduled";
  return (
    <SubmitNotice
      title={
        scheduled
          ? "This call for speakers hasn't opened yet"
          : "This call for speakers is closed"
      }
    >
      {scheduled && opensAt
        ? `Submissions open ${formatDeadline(opensAt, timezone)} — come back then.`
        : closesAt
          ? `Submissions closed ${formatDeadline(closesAt, timezone)}. Thanks for your interest — watch for the next call.`
          : "Submissions aren't being accepted right now. Watch for the next call."}
    </SubmitNotice>
  );
}
