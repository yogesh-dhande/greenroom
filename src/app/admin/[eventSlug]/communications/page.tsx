import type { EmailLog, Session, User } from "@/db/entities";
import {
  buildCommunicationLog,
  COMMS_TEMPLATES,
  COMMS_TEMPLATE_IDS,
  eventFields,
  INVITE_BLOCKER_LABELS,
  inviteBlocker,
  previewTaskDigestCount,
  resolveCommsTemplate,
  summarizeSessionInvites,
  TEMPLATE_MERGE_FIELDS,
} from "@/domain/comms";
import { resolveConfirmation } from "@/domain/onboarding";
import { formatEventTimeRange } from "@/lib/event-time";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { formatDay } from "@/components/date-format";
import { PageHeader } from "@/components/page-header";
import { CommsHub } from "./comms-hub";
import type { InviteRow, LogRow, SpeakerOption, TemplateRow } from "./types";

/**
 * The admin Communications hub (spec.md §7).
 *
 * Four questions an organizer actually has, in one place: what has this event
 * said to people (the log — spec's "communication log per speaker"), how do I
 * say something new (the composer), what do our standard messages say (the
 * template editor), and does everyone have their session in their calendar
 * (invites). All of it is loaded here through the storage-agnostic repository
 * layer and handed to client islands; writes go back through ./actions.ts.
 *
 * Admin-only (decisions.md D-047) — the full email log and the levers to send
 * mail as the event are organizer material; a reviewer never reaches this
 * page (the event-scoped admin guard bounces them to /admin).
 */
export default async function CommunicationsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const { user, event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const [sessions, rooms, submissions, assignments, overrides, rounds, tracks, eventSpeakers] = await Promise.all([
    repos.sessions.listByEvent(event.id),
    repos.rooms.listByEvent(event.id),
    repos.submissions.listByEvent(event.id),
    repos.taskAssignments.listByEvent(event.id),
    repos.emailTemplates.listByEvent(event.id),
    repos.reviewRounds.listByEvent(event.id),
    // Track names for the recipient picker's per-track groups — "everyone in
    // Agents" is a thing an organizer writes to, and the composer already has
    // every other half of the join in hand.
    repos.tracks.listByEvent(event.id),
    // The organizer's stored confirmation overrides (decisions.md D-068) —
    // needed alongside the session-attachment derivation below so the
    // recipient picker's "confirmed" badge can't call a speaker confirmed
    // after they've been explicitly marked Declined.
    repos.eventSpeakers.listByEvent(event.id),
  ]);

  // --- who this event's mail concerns -------------------------------------
  // Both halves matter: people on a session are the confirmed lineup, and
  // people on a submission include co-speakers whose proposal is still under
  // review — they get confirmations and change requests too. Reviewers join
  // the list too: the round assignments page can mail them a completion
  // nudge (D-050), and its sends belong in the same log as everyone else's.
  const [sessionLinks, submissionLinks, roundAssignments, submissionTracks] = await Promise.all([
    repos.sessions.listSpeakersBySessionIds(sessions.map((session) => session.id)),
    repos.submissions.listSpeakersBySubmissionIds(submissions.map((submission) => submission.id)),
    repos.reviewRounds.listAssignmentsByRounds(rounds.map((round) => round.id)),
    repos.submissions.listTracksBySubmissionIds(submissions.map((submission) => submission.id)),
  ]);
  // *Derived* confirmation only (decisions.md D-017) — attached to one of
  // this event's sessions. Used as-is for `personIds` (anyone with a session
  // belongs in the contact list regardless of an override), but the
  // recipient picker's "confirmed" badge below needs the *effective* value,
  // so a stored override is layered on via `resolveConfirmation` there.
  const derivedConfirmedIds = new Set(sessionLinks.map((link) => link.userId));
  const confirmationBySpeaker = new Map(
    eventSpeakers.map((member) => [member.userId, member.confirmationStatus]),
  );
  const personIds = [
    ...new Set([
      ...derivedConfirmedIds,
      ...submissionLinks.map((link) => link.userId),
      ...assignments.map((assignment) => assignment.speakerId),
      ...roundAssignments.map((assignment) => assignment.reviewerId),
    ]),
  ];
  const people = await repos.users.listByIds(personIds);

  // --- the log ------------------------------------------------------------
  // `email_log` rows are addressed to a person, not to an event, so an
  // event's correspondence is composed from both directions — see
  // buildCommunicationLog in src/domain/comms.ts.
  const [byRecipient, aboutSubmissions, aboutSessions, aboutAssignments] = await Promise.all([
    repos.emailLog.listByRecipients(people.map((person) => person.email)),
    repos.emailLog.listByRelatedIds("submission", submissions.map((s) => s.id)),
    repos.emailLog.listByRelatedIds("session", sessions.map((s) => s.id)),
    repos.emailLog.listByRelatedIds("task_assignment", assignments.map((a) => a.id)),
  ]);
  const log = buildCommunicationLog(
    byRecipient,
    aboutSubmissions,
    aboutSessions,
    aboutAssignments,
  );

  const peopleByEmail = new Map(people.map((person) => [person.email.toLowerCase(), person]));
  const contextFor = buildContextResolver({ sessions, submissions, assignments });
  const stamp = timestampFormatter(event.timezone);
  const logRows: LogRow[] = log.map((entry) =>
    toLogRow(entry, peopleByEmail, contextFor, stamp),
  );

  // --- what the recipient picker's groups are made of -----------------------
  // Both rollups are counted from lists already loaded above, so a chip's
  // tally can't drift from what the rest of the page says. Tracks reach a
  // person through their submissions: an organizer thinks "the Agents
  // speakers", and the join that answers that is submission → track.
  const trackNameById = new Map(tracks.map((track) => [track.id, track.name]));
  const trackNamesBySubmission = new Map<string, string[]>();
  for (const link of submissionTracks) {
    const name = trackNameById.get(link.trackId);
    if (!name) continue;
    trackNamesBySubmission.set(link.submissionId, [
      ...(trackNamesBySubmission.get(link.submissionId) ?? []),
      name,
    ]);
  }
  const trackNamesBySpeaker = new Map<string, Set<string>>();
  for (const link of submissionLinks) {
    const names = trackNamesBySubmission.get(link.submissionId);
    if (!names) continue;
    const collected = trackNamesBySpeaker.get(link.userId) ?? new Set<string>();
    for (const name of names) collected.add(name);
    trackNamesBySpeaker.set(link.userId, collected);
  }
  const pendingTasksBySpeaker = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.status === "completed") continue;
    pendingTasksBySpeaker.set(
      assignment.speakerId,
      (pendingTasksBySpeaker.get(assignment.speakerId) ?? 0) + 1,
    );
  }

  const speakers: SpeakerOption[] = people
    .map((person) => ({
      id: person.id,
      name: person.name?.trim() || person.email,
      email: person.email,
      company: person.company,
      pendingTasks: pendingTasksBySpeaker.get(person.id) ?? 0,
      trackNames: [...(trackNamesBySpeaker.get(person.id) ?? [])].sort((a, b) =>
        a.localeCompare(b),
      ),
      // Effective confirmation (decisions.md D-068): the organizer's stored
      // answer wins when there is one, so a speaker marked Declined doesn't
      // carry the "On the program" badge just because their session is
      // still on the books.
      confirmed: resolveConfirmation(
        confirmationBySpeaker.get(person.id) ?? null,
        derivedConfirmedIds.has(person.id),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // --- templates ----------------------------------------------------------
  const templates: TemplateRow[] = COMMS_TEMPLATE_IDS.map((id) => {
    const builtIn = COMMS_TEMPLATES[id];
    const resolved = resolveCommsTemplate(id, overrides);
    return {
      id,
      name: builtIn.name,
      description: builtIn.description,
      subject: resolved.subject,
      body: resolved.body,
      defaultSubject: builtIn.subject,
      defaultBody: builtIn.body,
      isOverride: resolved.isOverride,
      availableFields: TEMPLATE_MERGE_FIELDS[id],
    };
  });

  // --- invites ------------------------------------------------------------
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const speakerIdsBySession = new Map<string, string[]>();
  for (const link of sessionLinks) {
    speakerIdsBySession.set(link.sessionId, [
      ...(speakerIdsBySession.get(link.sessionId) ?? []),
      link.userId,
    ]);
  }
  const invites = summarizeSessionInvites(log);

  const inviteRows: InviteRow[] = sessions
    // Agenda order comes off the raw day/time, never the formatted label:
    // "Sep 23 · 1:00 PM" sorts before "Sep 23 · 10:00 AM" as a string.
    .toSorted(
      (a, b) =>
        `${a.day ?? "9999-99-99"} ${a.startTime ?? "99:99"}`.localeCompare(
          `${b.day ?? "9999-99-99"} ${b.startTime ?? "99:99"}`,
        ) || a.title.localeCompare(b.title),
    )
    .map((session): InviteRow => {
      const speakerIds = speakerIdsBySession.get(session.id) ?? [];
      const blocker = inviteBlocker(session, speakerIds.length);
      const summary = invites.get(session.id);
      return {
        sessionId: session.id,
        title: session.title,
        when:
          session.day && session.startTime && session.endTime
            ? `${formatDay(session.day)} · ${formatEventTimeRange(
                session.day,
                session.startTime,
                session.endTime,
                event.timezone,
              )}`
            : null,
        room: session.roomId ? (roomsById.get(session.roomId)?.name ?? null) : null,
        speakers: speakerIds.map(
          (id) => peopleById.get(id)?.name?.trim() || peopleById.get(id)?.email || "Unknown",
        ),
        sentCount: summary?.sentCount ?? 0,
        lastSentLabel: summary?.lastSentAt ? stamp(summary.lastSentAt) : null,
        blockedReason: blocker ? INVITE_BLOCKER_LABELS[blocker] : null,
      };
    })
    // Sessions that can be invited on come first; Array#sort is stable, so
    // each group keeps the agenda order established above.
    .sort((a, b) => Number(Boolean(a.blockedReason)) - Number(Boolean(b.blockedReason)));

  // --- composer preview data -----------------------------------------------
  // The same event fields (real dates, URLs, and the sending admin's name)
  // the actual send path renders with — `eventFields` in src/domain/comms.ts
  // — so the composer's on-screen preview stops showing placeholder June
  // dates and example.com links for a real event (decisions.md D-053).
  // Per-recipient fields (speakerName, etc.) aren't known yet at this point,
  // so those stay `templatePreviewData`'s placeholders in the client.
  const comms = await getCommsContext({
    repos,
    organizerName: user.name?.trim() || user.email,
    organizerEmail: user.email,
  });
  const eventMergeData = eventFields(comms, event);

  // --- task digest confirmation --------------------------------------------
  // How many speakers "Send task digest now" would actually reach right now
  // — the same decision `sendRemindersNow` makes (decisions.md D-039), just
  // counted instead of sent, so the confirm dialog can promise an honest
  // number before the admin commits to the click.
  const digestPreviewCount = await previewTaskDigestCount(comms, event);

  // Captured once, server-side, and handed down as a prop rather than read
  // via `Date.now()` inside the client log table: the log table hydrates
  // with the exact same value the server rendered, so the log's relative
  // "2h ago" timestamps never mismatch between SSR and hydration the way a
  // client-computed "now" would (see LogRow's sentAtLabel comment on the
  // same class of bug for absolute timestamps). `new Date().getTime()`
  // rather than `Date.now()` because React's purity lint flags the latter as
  // a known-impure call during render, even here where it only runs once per
  // request.
  const now = new Date().getTime();

  return (
    <div>
      <PageHeader
        title="Communications"
        description="Everything this event has said to its speakers — and everything it's about to."
      />
      <CommsHub
        eventSlug={eventSlug}
        eventMergeData={eventMergeData}
        logRows={logRows}
        speakers={speakers}
        templates={templates}
        invites={inviteRows}
        digestPreviewCount={digestPreviewCount}
        now={now}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row assembly
// ---------------------------------------------------------------------------

/**
 * Turns an email's `relatedType`/`relatedId` pair into something an organizer
 * recognises — the talk title, the session, the task — so the log reads as a
 * history rather than a table of subject lines and opaque ids.
 */
function buildContextResolver({
  sessions,
  submissions,
  assignments,
}: {
  sessions: Session[];
  submissions: Array<{ id: string; title: string }>;
  assignments: Array<{ id: string; taskId: string }>;
}) {
  const submissionTitles = new Map(submissions.map((s) => [s.id, s.title]));
  const sessionTitles = new Map(sessions.map((s) => [s.id, s.title]));
  const assignmentIds = new Set(assignments.map((a) => a.id));

  return (relatedType: string | null, relatedId: string | null): string | null => {
    if (!relatedType || !relatedId) return null;
    if (relatedType === "submission") return submissionTitles.get(relatedId) ?? null;
    if (relatedType === "session") return sessionTitles.get(relatedId) ?? null;
    // Task titles would need a third lookup for a line the reader can already
    // read off the subject ("Reminder: Upload your headshot").
    if (relatedType === "task_assignment") {
      return assignmentIds.has(relatedId) ? "Onboarding task" : null;
    }
    return null;
  };
}

/**
 * "Jun 16, 10:04 AM PDT" in the event's own timezone.
 *
 * Formatting happens here rather than in the client island on purpose: the
 * server renders in UTC and the browser in the viewer's zone, so a timestamp
 * formatted on both sides is a guaranteed hydration mismatch.
 */
function timestampFormatter(timeZone: string): (instant: Date) => string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (instant) => formatter.format(instant).replace(",", "");
}

function toLogRow(
  entry: EmailLog,
  peopleByEmail: Map<string, User>,
  contextFor: (relatedType: string | null, relatedId: string | null) => string | null,
  stamp: (instant: Date) => string,
): LogRow {
  return {
    id: entry.id,
    to: entry.to,
    toName: peopleByEmail.get(entry.to.toLowerCase())?.name?.trim() || null,
    subject: entry.subject,
    kind: entry.kind,
    status: entry.status,
    error: entry.error,
    sentAt: entry.sentAt.toISOString(),
    sentAtLabel: stamp(entry.sentAt),
    context: contextFor(entry.relatedType, entry.relatedId),
  };
}
