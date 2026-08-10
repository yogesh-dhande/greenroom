import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import type { DirectoryContact } from "@/db/repos/contacts";
import {
  buildContactActivity,
  contactDisplayName,
  type ContactActivityItem,
} from "@/domain/crm";
import { PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { isImageKey, keyFromFileUrl } from "@/lib/uploads";
import { formatDate, formatDateRange } from "@/components/date-format";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EMAIL_KIND_LABELS } from "@/app/admin/[eventSlug]/communications/types";
import { AddToEventDialog } from "./add-to-event-dialog";
import { ContactNoteForm } from "./contact-note-form";
import { ContactTags } from "./contact-tags";
import type { EventOption } from "../types";

/**
 * Most recent activity shown before the feed collapses to "…and N older" —
 * a contact who has been through several events otherwise produces a card
 * that is mostly scroll. Same rule as the event speaker record's email
 * history.
 */
const ACTIVITY_LIMIT = 20;

/** One line of the activity feed, in the words an organizer reads. */
function activityLabel(item: ContactActivityItem): string {
  switch (item.kind) {
    case "email":
      return item.subject;
    case "stage":
      return item.from === null
        ? `Enrolled in the pipeline as ${PIPELINE_STAGE_LABELS[item.to]}`
        : `Moved to ${PIPELINE_STAGE_LABELS[item.to]}`;
    case "note":
      return item.body.length > 140 ? `${item.body.slice(0, 140)}…` : item.body;
  }
}

/** The muted second line: what kind of thing happened, and when. */
function activityKindLabel(item: ContactActivityItem): string {
  switch (item.kind) {
    case "email":
      return EMAIL_KIND_LABELS[item.emailKind];
    case "stage":
      return "Pipeline";
    case "note":
      return "Internal note";
  }
}

/**
 * One contact's org-level profile (spec.md "Org-level speaker CRM",
 * decisions.md D-077): who they are, what your team thinks of them, every
 * event they have touched, and everything that has happened with them — in
 * one place that outlives any single event.
 *
 * Deliberately *not* the event speaker record (D-051): that page is about one
 * event's onboarding, this one is about the person. The two never disagree,
 * because both read the same global user record (identity is email-global).
 *
 * Admin-only (roles are global, D-025); guarded here as well as in the (org)
 * layout, since a page's authorization is its own.
 */
export default async function ContactProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  await requireAdmin(`/admin/directory/${userId}`);

  const repos = await getRepos();
  const detail = await repos.contacts.getDetail(userId);
  if (!detail) notFound();

  const { user, tags, notes, events, card } = detail;
  const displayName = contactDisplayName(user);

  const [directory, allEvents, emails, stageEvents] = await Promise.all([
    repos.contacts.listDirectory(),
    repos.events.listAll(),
    // Address-keyed, so mail sent before they ever claimed an account still
    // counts — and mail sent for any event, since a person's inbox doesn't
    // reset between events (see `EmailLogRepo.listByRecipient`).
    repos.emailLog.listByRecipient(user.email),
    repos.pipeline.listHistoryByUser(userId),
  ]);

  // Same-name collisions across the whole directory (decisions.md D-059).
  // Flagged and linked, never merged — D-065 keeps merge out of scope, and
  // side-by-side links are the guard that replaces it.
  const duplicates: DirectoryContact[] = directory.filter(
    (other) =>
      other.userId !== user.id &&
      contactDisplayName(other).toLowerCase() === displayName.toLowerCase(),
  );

  const activity = buildContactActivity({ emails, stageEvents, notes });
  const activityShown = activity.slice(0, ACTIVITY_LIMIT);
  const activityOlderCount = activity.length - activityShown.length;

  // Note authors resolved in one read rather than one per note.
  const authorIds = [...new Set(notes.map((note) => note.authorUserId).filter(Boolean))];
  const authors = await repos.users.listByIds(authorIds as string[]);
  const authorNames = new Map(authors.map((author) => [author.id, author.name ?? author.email]));

  const connectedEventIds = new Set(events.map((link) => link.eventId));
  const eventOptions: EventOption[] = allEvents.map((event) => ({
    id: event.id,
    slug: event.slug,
    name: event.name,
    dates: formatDateRange(event.startDate, event.endDate),
    connected: connectedEventIds.has(event.id),
  }));

  const headshotKey = user.headshotUrl ? keyFromFileUrl(user.headshotUrl) : null;

  return (
    <div>
      <Link
        href="/admin/directory"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        All contacts
      </Link>

      <PageHeader
        title={displayName}
        description={user.email}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AddToEventDialog userId={user.id} events={eventOptions} />
          </div>
        }
      />

      {duplicates.length > 0 ? (
        // The same hazard the directory badge flags, with follow-through: the
        // badge alone gave no way to see the colliding record. Display only —
        // no merge action (decisions.md D-059, D-065).
        <Card className="mb-4 border-warning bg-warning/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="outline" className="border-warning bg-warning/10 text-warning">
                Possible duplicate
              </Badge>
            </CardTitle>
            <CardDescription>
              Another contact uses the same display name. These are distinct records that happen to
              share a name — open the other profile to compare before assuming they&apos;re the
              same person.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {duplicates.map((other) => (
                <li key={other.userId}>
                  <Link
                    href={`/admin/directory/${other.userId}`}
                    className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {contactDisplayName(other)}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{other.email}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                One record, shared by every event they speak at — they maintain it themselves in
                the speaker portal.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start gap-4">
                {user.headshotUrl && (!headshotKey || isImageKey(headshotKey)) ? (
                  // A small fixed-size avatar of an unknown-at-build-time URL
                  // (an uploaded /files/<key> or an imported absolute one), so
                  // next/image buys nothing here — same call as the event
                  // speaker record.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.headshotUrl}
                    alt={`${displayName}'s headshot`}
                    className="size-16 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground">
                    No photo
                  </div>
                )}
                <dl className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Name</dt>
                    <dd className="text-sm text-foreground">{user.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd className="truncate text-sm text-foreground">{user.email}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Title</dt>
                    <dd className="text-sm text-foreground">{user.title ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Company</dt>
                    <dd className="text-sm text-foreground">{user.company ?? "—"}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Bio</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {user.bio ?? "No bio yet — the contact can add one from their portal profile."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Internal notes</CardTitle>
              <CardDescription>
                Your team&apos;s own record of this person, kept across every event. Never shown to
                the contact.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ContactNoteForm userId={user.id} />

              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {notes.map((note) => (
                    <li key={note.id} className="flex flex-col gap-0.5 border-t border-border pt-3">
                      <p className="whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
                      <span className="text-xs text-muted-foreground">
                        {(note.authorUserId ? authorNames.get(note.authorUserId) : null) ??
                          "Unknown author"}{" "}
                        · {formatDate(note.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>
                Emails they&apos;ve been sent, pipeline moves, and notes — newest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing yet. Emails, pipeline moves and notes all show up here.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-3">
                    {activityShown.map((item) => (
                      <li key={`${item.kind}-${item.id}`} className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {activityLabel(item)}
                          </span>
                          {item.kind === "email" && item.status === "failed" ? (
                            <Badge
                              variant="outline"
                              className="border-destructive bg-destructive/10 text-destructive"
                            >
                              Failed
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {activityKindLabel(item)} · {formatDate(item.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {activityOlderCount > 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      …and {activityOlderCount} older
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
              <CardDescription>Free-form labels you can filter the directory by.</CardDescription>
            </CardHeader>
            <CardContent>
              <ContactTags userId={user.id} tags={tags} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Connected events</CardTitle>
              <CardDescription>Every event they&apos;re on, and what they spoke on.</CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <EmptyState
                  title="Not on any event yet"
                  description="Use Add to event to put them on a roster — their profile carries over."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {events.map((link) => (
                    <li key={link.eventId} className="flex flex-col gap-1">
                      <Link
                        href={`/admin/${link.eventSlug}/speakers/${user.id}`}
                        className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {link.eventName}
                      </Link>
                      {link.sessionTitles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          On the roster, no session yet
                        </span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {link.sessionTitles.map((title) => (
                            <li key={title} className="text-xs text-muted-foreground">
                              {title}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
              <CardDescription>Where they sit on the sourcing board.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {card ? (
                <>
                  <Badge variant="outline">{PIPELINE_STAGE_LABELS[card.stage]}</Badge>
                  {card.score !== null ? (
                    <p className="text-sm text-muted-foreground">Score {card.score}</p>
                  ) : null}
                  <Link
                    href={`/admin/pipeline/${card.id}`}
                    className="text-sm text-foreground underline-offset-4 hover:underline"
                  >
                    Open pipeline card
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Not on the sourcing board.</p>
                  <Link
                    href="/admin/pipeline"
                    className="text-sm text-foreground underline-offset-4 hover:underline"
                  >
                    Open the pipeline
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
