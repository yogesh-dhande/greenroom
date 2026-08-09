import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PROFILE_FORM_FIELDS, profileFormValues, profileLinks } from "@/domain/profile";
import { PageHeader } from "@/components/page-header";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { saveProfile, uploadHeadshot } from "./actions";

/**
 * A speaker's own profile (spec.md §6 — "edits their own profile (name, title,
 * company, bio, social/web links) and headshot, which feed the admin roster
 * and public gallery").
 *
 * Rendered through the shared schema-driven form so the profile inherits the
 * same controls, validation plumbing, and upload-on-pick behaviour as the CFP
 * and onboarding tasks; the field schema itself is synthetic (see
 * src/domain/profile.ts) because these questions are the product's, not an
 * organizer's to edit.
 *
 * The session only carries identity, so the stored user is loaded here — the
 * profile columns live on the `User` entity, reached through `UsersRepo`.
 */
export default async function ProfilePage() {
  const sessionUser = await requireUser("/portal/profile");

  const repos = await getRepos();
  const user = await repos.users.getById(sessionUser.id);
  if (!user) notFound();

  const links = profileLinks(user);

  return (
    <div>
      <PageHeader
        title="Your profile"
        description="Bio, headshot, and links — shown on the public speaker gallery and to the organizers."
      />

      {user.headshotUrl ? (
        <div className="mb-6 flex items-center gap-4 rounded-lg border border-border bg-card p-4">
          {/* A small fixed-size avatar of an unknown-at-build-time URL (an
              uploaded /files/<key> or an imported absolute one), so next/image
              buys nothing here — same call as the public gallery's headshot. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={user.headshotUrl}
            alt="Your current headshot"
            className="size-16 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Your current headshot</p>
            <p className="text-sm text-muted-foreground">
              This is what the public speaker gallery shows. Upload a new image below to replace it.
            </p>
          </div>
        </div>
      ) : null}

      <SchemaForm
        fields={PROFILE_FORM_FIELDS}
        defaultValues={{ ...profileFormValues(user) }}
        submitLabel="Save profile"
        pendingLabel="Saving…"
        action={saveProfile}
        uploadAction={uploadHeadshot}
        uploadScope="profile"
        footnote={
          <p className="text-sm text-muted-foreground">
            {links.length > 0
              ? "Your bio, headshot, and links appear on the event's public speaker page as soon as you save."
              : "Add any links you'd like attendees to find — they appear on your public speaker card."}
          </p>
        }
      />
    </div>
  );
}
