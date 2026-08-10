/**
 * The merge fields an *org-level* message can actually fill in (spec.md
 * "Org-level speaker CRM", decisions.md D-077).
 *
 * Bulk outreach from the directory picks people, not proposals — and, unlike
 * the event composer's `MANUAL_MERGE_FIELDS`, not an event either. Every
 * event-shaped field (`eventName`, `eventDates`, `eventLocation`,
 * `eventTimezone`, `eventUrl`) and everything derived from an event roster
 * (`outstandingTasks`) is therefore left off this list rather than rendered
 * blank: `checkTemplateDraft` reports an unavailable field as a blocking
 * error, which is exactly the answer an organizer needs *before* the send
 * rather than after (decisions.md D-020).
 *
 * What remains is what the send path can honestly resolve for a contact who
 * may not be on any roster at all: their own name, the acting admin's name
 * and reply address, and the portal URL (app-level, not event-level).
 *
 * Pure and dependency-free so both halves of the composer can share it — the
 * server action that sends, and the client dialog that validates and previews.
 */
import type { MergeData, MergeField } from "@/domain/comms-templates";

/** Fields src/app/admin/(org)/directory/actions.ts fills for every recipient. */
export const ORG_MERGE_FIELDS: MergeField[] = [
  "speakerName",
  "speakerFirstName",
  "organizerName",
  "organizerEmail",
  "portalUrl",
];

/** A contact, as little of one as the merge data needs. */
export interface OrgMergeContact {
  name: string | null;
  email: string;
}

/**
 * The recipient half of the merge data, matching `speakerFields` in
 * src/domain/comms.ts exactly: the display name falls back to the address (a
 * contact imported from a bare mailing list has no name), and the first name
 * falls back to "there" so "Hi {{speakerFirstName}}," never opens with a
 * comma hanging off nothing.
 */
export function orgSpeakerFields(contact: OrgMergeContact): MergeData {
  const name = contact.name?.trim();
  return {
    speakerName: name || contact.email,
    speakerFirstName: name ? name.split(/\s+/)[0] : "there",
  };
}

/** `{appUrl}/portal`, matching `portalUrl` in src/domain/comms.ts. */
export function orgPortalUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/portal`;
}
