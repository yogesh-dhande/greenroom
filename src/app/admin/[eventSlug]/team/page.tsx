import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm } from "./invite-form";
import { TeamTable } from "./team-table";
import type { TeamMemberRow, TrackOption } from "./types";

/**
 * Team management (spec.md §1 roles; decisions.md D-043).
 *
 * Roles used to be a `wrangler d1 execute` one-liner (docs/deploying.md §7);
 * this page is the whole of it — who has admin or reviewer access, which
 * tracks each reviewer's queue is drawn from, and how someone new is added.
 *
 * Organizer-only, guarded exactly like event settings: a reviewer who reaches
 * the URL directly is bounced to /admin, and the nav never offers them the
 * link (src/components/admin-nav.tsx).
 */
export default async function TeamPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const viewer = await requireAdmin(`/admin/${eventSlug}/team`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const [admins, reviewers, tracks] = await Promise.all([
    repos.users.listByRole("admin"),
    repos.users.listByRole("reviewer"),
    repos.tracks.listByEvent(event.id),
  ]);

  // Reviewer routing is read per track rather than per reviewer: the join has
  // no event column, so walking this event's tracks is what scopes the answer
  // to this event. Tracks per event are a handful, reviewers can be many.
  const trackReviewerIds = await Promise.all(
    tracks.map(async (track) => ({ track, userIds: await repos.tracks.listReviewerIds(track.id) })),
  );
  const trackIdsByReviewer = new Map<string, string[]>();
  for (const { track, userIds } of trackReviewerIds) {
    for (const userId of userIds) {
      trackIdsByReviewer.set(userId, [...(trackIdsByReviewer.get(userId) ?? []), track.id]);
    }
  }

  const trackOptions: TrackOption[] = tracks.map((track) => ({ id: track.id, name: track.name }));
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));

  const byName = (a: { name: string | null; email: string }, b: { name: string | null; email: string }) =>
    (a.name?.trim() || a.email).localeCompare(b.name?.trim() || b.email);

  // Admins first — an organizer scanning this page is usually checking who
  // holds the keys, not who is on the review committee.
  const members: TeamMemberRow[] = [...admins.toSorted(byName), ...reviewers.toSorted(byName)].map(
    (person) => {
      const trackIds = person.role === "reviewer" ? (trackIdsByReviewer.get(person.id) ?? []) : [];
      return {
        id: person.id,
        name: person.name?.trim() || null,
        email: person.email,
        role: person.role,
        isViewer: person.id === viewer.id,
        hasSignedIn: person.emailVerified,
        trackIds,
        trackNames: trackIds
          .map((id) => trackNames.get(id) ?? "")
          .filter(Boolean)
          .toSorted((a, b) => a.localeCompare(b)),
      };
    },
  );

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Team"
        description="Who can get into the admin area, and what each reviewer sees."
      />

      <Card>
        <CardHeader>
          <CardTitle>Admins and reviewers</CardTitle>
          <CardDescription>
            Admins run the event end to end. Reviewers only see submissions in the tracks assigned
            to them here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeamTable
            eventSlug={eventSlug}
            members={members}
            tracks={trackOptions}
            adminCount={admins.length}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a teammate</CardTitle>
          <CardDescription>
            Works whether or not they already have a Greenroom account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm eventSlug={eventSlug} />
        </CardContent>
      </Card>
    </div>
  );
}
