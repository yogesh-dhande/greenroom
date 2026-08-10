import type {
  Contact,
  ContactNote,
  ContactSource,
  ContactTag,
  NewContactNote,
  PipelineCard,
  User,
} from "@/db/entities";

/**
 * The org-level contact directory (spec.md "Org-level speaker CRM",
 * decisions.md D-077).
 *
 * The directory is a *union*, not a table: everyone who is a speaker on at
 * least one event, plus everyone in the `contacts` registry. A speaker
 * therefore never needs a registry row, and adding someone to the registry who
 * already speaks somewhere changes nothing about whether they appear — only
 * how they got there. "Speaker on an event" means the same three sources the
 * event roster unions (`rosterSpeakerIds` in src/domain/onboarding.ts): a
 * session assignment, a task assignment, or an `event_speakers` record.
 *
 * Storage-agnostic like every other repo here: implementations return the
 * plain types from src/db/entities.ts and the read models below, never rows.
 */

/**
 * The directory's narrowing, all ANDed — an omitted or blank field is a
 * wildcard. This is also exactly what a saved segment stores
 * (src/domain/segments.ts), so any field added here has to survive a
 * round trip through `serializeSegmentQuery`/`parseSegmentQuery`.
 */
export interface DirectoryFilter {
  /** Case-insensitive substring over name and email. */
  q?: string;
  /**
   * Case-insensitive substring over company. Substring rather than equality so
   * one vocabulary serves both the free-text filter box and the top-companies
   * widget linking in with a full company name (which still matches, being a
   * substring of itself) — the same rule `matchesSpeakerSearch` uses on the
   * event roster.
   */
  company?: string;
  /** A normalized tag label; the contact matches when they carry it. */
  tag?: string;
}

/** One row of the directory table. */
export interface DirectoryContact {
  userId: string;
  name: string | null;
  email: string;
  title: string | null;
  company: string | null;
  headshotUrl: string | null;
  /** Normalized labels, ascending. */
  tags: string[];
  /** How many distinct events this person is connected to. */
  eventCount: number;
  /** True when a `contacts` registry row exists (added by hand or imported). */
  inRegistry: boolean;
}

/**
 * One event a contact is connected to. `sessionTitles` is the cheap half of
 * "role": a contact with sessions here is speaking, one without is on the
 * roster some other way (imported, task-assigned, hand-added).
 */
export interface ContactEventLink {
  eventId: string;
  eventName: string;
  eventSlug: string;
  sessionTitles: string[];
}

/** Everything one contact profile page reads, in one call. */
export interface ContactDetail {
  user: User;
  /** The registry row, or null for a contact who is only ever a speaker. */
  registry: Contact | null;
  /** Normalized labels, ascending. */
  tags: string[];
  /** Org-level internal notes, newest first. */
  notes: ContactNote[];
  /** Connected events, by event name. */
  events: ContactEventLink[];
  /** Their sourcing-pipeline card, if they have been enrolled. */
  card: PipelineCard | null;
}

export interface ContactsRepo {
  /**
   * The directory, filtered server-side and ordered by display name (the
   * name, or the email when there is none) case-insensitively.
   *
   * Filtering happens in the datastore rather than over a full read: the
   * search box, the company filter and the tag filter compose with AND, and
   * `matchesDirectoryFilter` in src/domain/crm.ts is the same rule in pure
   * form (what segment previews and the unit tests use).
   */
  listDirectory(filter?: DirectoryFilter): Promise<DirectoryContact[]>;
  /** Null when the id is not a user at all; a user who is neither a speaker
   * nor registered still resolves, with empty events and no registry row. */
  getDetail(userId: string): Promise<ContactDetail | null>;
  /** The events one contact is connected to, by event name. */
  listEventLinks(userId: string): Promise<ContactEventLink[]>;

  // --- registry ---
  /** Idempotent by user: re-adding leaves the original row (and its source)
   * alone, the same contract as `EventSpeakersRepo.add`. */
  addToRegistry(userId: string, source?: ContactSource): Promise<Contact>;

  // --- tags ---
  listTags(userId: string): Promise<ContactTag[]>;
  /** Batch form for the directory table. */
  listTagsByUsers(userIds: string[]): Promise<ContactTag[]>;
  /** Every label in use, ascending — the filter bar's tag list. */
  listAllLabels(): Promise<string[]>;
  /**
   * Idempotent: adding a tag someone already carries returns the existing row.
   * `label` is normalized by the implementation, so callers may pass raw
   * organizer input.
   */
  addTag(userId: string, label: string): Promise<ContactTag>;
  /** No-op when the tag isn't there. `label` is normalized like `addTag`. */
  removeTag(userId: string, label: string): Promise<void>;

  // --- org-level notes (append-only; distinct from event_speakers.notes) ---
  /** Newest first. */
  listNotes(userId: string): Promise<ContactNote[]>;
  addNote(input: NewContactNote): Promise<ContactNote>;
}
