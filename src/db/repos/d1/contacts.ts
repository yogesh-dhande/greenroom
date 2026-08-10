import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  contactNoteSchema,
  contactSchema,
  contactTagSchema,
  pipelineCardSchema,
  userSchema,
  type ContactSource,
  type NewContactNote,
} from "@/db/entities";
import {
  contactNotes,
  contactTags,
  contacts,
  eventSpeakers,
  events,
  pipelineCards,
  sessionSpeakers,
  sessions,
  taskAssignments,
  tasks,
  users,
} from "@/db/schema";
import type {
  ContactDetail,
  ContactEventLink,
  ContactsRepo,
  DirectoryContact,
  DirectoryFilter,
} from "@/db/repos/contacts";
import { normalizeDirectoryFilter, normalizeTagLabel, sortDirectoryContacts } from "@/domain/crm";
import { inIdChunks } from "./chunk";
import type { DrizzleD1 } from "./client";

/**
 * D1/Drizzle implementation of the org-level contact directory (decisions.md
 * D-077). Drizzle stays inside this file; callers see only the entity types
 * and the read models from src/db/repos/contacts.ts.
 *
 * The pure rules it needs — how a tag label normalizes, how a filter
 * normalizes, what order the directory is in — are imported from
 * src/domain/crm.ts rather than restated in SQL terms, so the server-side
 * narrowing below and the in-memory `matchesDirectoryFilter` can't drift.
 */

/** LIKE metacharacters an organizer can legitimately type into a search box. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Case-insensitive "contains", with `%`/`_` in the needle treated as text.
 *
 * SQLite's `lower()` folds ASCII only, so an accented name matches only when
 * the organizer types the same case for the accented letter. The pure
 * `matchesDirectoryFilter` folds the full Unicode range; the two agree on
 * everything ASCII, which is what a search box gets used for.
 */
function containsFold(column: SQLiteColumn, needle: string): SQL {
  const pattern = `%${escapeLike(needle.toLowerCase())}%`;
  return sql`lower(${column}) LIKE ${pattern} ESCAPE '\\'`;
}

export function createContactsRepo(db: DrizzleD1): ContactsRepo {
  /**
   * Every (person, event) connection in the org, from the same three sources
   * the event roster unions (`rosterSpeakerIds` in src/domain/onboarding.ts):
   * an `event_speakers` record, a session assignment, or a task assignment.
   * Reading all three and unioning in memory keeps this one definition of
   * "connected" instead of a fourth one written in SQL.
   */
  async function eventLinkPairs(userId?: string): Promise<Array<{ userId: string; eventId: string }>> {
    const [members, viaSessions, viaTasks] = await Promise.all([
      db
        .select({ userId: eventSpeakers.userId, eventId: eventSpeakers.eventId })
        .from(eventSpeakers)
        .where(userId ? eq(eventSpeakers.userId, userId) : undefined),
      db
        .select({ userId: sessionSpeakers.userId, eventId: sessions.eventId })
        .from(sessionSpeakers)
        .innerJoin(sessions, eq(sessions.id, sessionSpeakers.sessionId))
        .where(userId ? eq(sessionSpeakers.userId, userId) : undefined),
      db
        .select({ userId: taskAssignments.speakerId, eventId: tasks.eventId })
        .from(taskAssignments)
        .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
        .where(userId ? eq(taskAssignments.speakerId, userId) : undefined),
    ]);
    return [...members, ...viaSessions, ...viaTasks];
  }

  function groupEventsByUser(
    pairs: Array<{ userId: string; eventId: string }>,
  ): Map<string, Set<string>> {
    const byUser = new Map<string, Set<string>>();
    for (const pair of pairs) {
      const set = byUser.get(pair.userId) ?? new Set<string>();
      set.add(pair.eventId);
      byUser.set(pair.userId, set);
    }
    return byUser;
  }

  async function tagsByUser(userIds: string[]): Promise<Map<string, string[]>> {
    const rows = await inIdChunks(userIds, (chunk) =>
      db
        .select({ userId: contactTags.userId, label: contactTags.label })
        .from(contactTags)
        .where(inArray(contactTags.userId, chunk))
        .orderBy(asc(contactTags.label)),
    );
    const byUser = new Map<string, string[]>();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row.label);
      byUser.set(row.userId, list);
    }
    return byUser;
  }

  /** Connected events for one contact, by event name. */
  async function loadEventLinks(userId: string): Promise<ContactEventLink[]> {
    const [pairs, sessionRows] = await Promise.all([
      eventLinkPairs(userId),
      db
        .select({ eventId: sessions.eventId, title: sessions.title })
        .from(sessionSpeakers)
        .innerJoin(sessions, eq(sessions.id, sessionSpeakers.sessionId))
        .where(eq(sessionSpeakers.userId, userId)),
    ]);

    const eventIds = [...new Set(pairs.map((pair) => pair.eventId))];
    if (eventIds.length === 0) return [];

    const eventRows = await inIdChunks(eventIds, (chunk) =>
      db
        .select({ id: events.id, name: events.name, slug: events.slug })
        .from(events)
        .where(inArray(events.id, chunk)),
    );

    const titlesByEvent = new Map<string, string[]>();
    for (const row of sessionRows) {
      const list = titlesByEvent.get(row.eventId) ?? [];
      list.push(row.title);
      titlesByEvent.set(row.eventId, list);
    }

    const links: ContactEventLink[] = eventRows.map((event) => ({
      eventId: event.id,
      eventName: event.name,
      eventSlug: event.slug,
      sessionTitles: (titlesByEvent.get(event.id) ?? []).sort((a, b) => a.localeCompare(b)),
    }));
    return links.sort((a, b) => a.eventName.localeCompare(b.eventName));
  }

  return {
    async listDirectory(filter?: DirectoryFilter) {
      const { q, company, tag } = normalizeDirectoryFilter(filter);

      const [pairs, registryRows] = await Promise.all([
        eventLinkPairs(),
        db.select().from(contacts),
      ]);
      const eventsByUser = groupEventsByUser(pairs);
      const registeredIds = new Set(registryRows.map((row) => row.userId));

      let candidateIds = new Set<string>([...eventsByUser.keys(), ...registeredIds]);
      if (tag) {
        // Narrowed before the user read so the tag filter costs one extra
        // statement rather than a tag lookup per candidate.
        const tagged = await db
          .select({ userId: contactTags.userId })
          .from(contactTags)
          .where(eq(contactTags.label, tag));
        const taggedIds = new Set(tagged.map((row) => row.userId));
        candidateIds = new Set([...candidateIds].filter((id) => taggedIds.has(id)));
      }
      if (candidateIds.size === 0) return [];

      const conditions: SQL[] = [];
      if (q) {
        const search = or(containsFold(users.name, q), containsFold(users.email, q));
        if (search) conditions.push(search);
      }
      if (company) conditions.push(containsFold(users.company, company));

      const rows = await inIdChunks([...candidateIds], (chunk) =>
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            title: users.title,
            company: users.company,
            headshotUrl: users.headshotUrl,
          })
          .from(users)
          .where(and(inArray(users.id, chunk), ...conditions)),
      );

      const tags = await tagsByUser(rows.map((row) => row.id));
      const directory: DirectoryContact[] = rows.map((row) => ({
        userId: row.id,
        name: row.name,
        email: row.email,
        title: row.title,
        company: row.company,
        headshotUrl: row.headshotUrl,
        tags: tags.get(row.id) ?? [],
        eventCount: eventsByUser.get(row.id)?.size ?? 0,
        inRegistry: registeredIds.has(row.id),
      }));
      return sortDirectoryContacts(directory);
    },

    listEventLinks(userId) {
      return loadEventLinks(userId);
    },

    async getDetail(userId) {
      const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!row) return null;

      const [registryRow, tagRows, noteRows, eventLinks, cardRow] = await Promise.all([
        db.query.contacts.findFirst({ where: eq(contacts.userId, userId) }),
        db.query.contactTags.findMany({
          where: eq(contactTags.userId, userId),
          orderBy: [asc(contactTags.label)],
        }),
        db.query.contactNotes.findMany({
          where: eq(contactNotes.userId, userId),
          orderBy: [desc(contactNotes.createdAt)],
        }),
        loadEventLinks(userId),
        db.query.pipelineCards.findFirst({ where: eq(pipelineCards.userId, userId) }),
      ]);

      const detail: ContactDetail = {
        user: userSchema.parse(row),
        registry: registryRow ? contactSchema.parse(registryRow) : null,
        tags: tagRows.map((tagRow) => tagRow.label),
        notes: noteRows.map((noteRow) => contactNoteSchema.parse(noteRow)),
        events: eventLinks,
        card: cardRow ? pipelineCardSchema.parse(cardRow) : null,
      };
      return detail;
    },

    async addToRegistry(userId, source: ContactSource = "manual") {
      // Same shape as EventSpeakersRepo.add: a conflict means the row is
      // already there, and the caller wants the original (with its original
      // source and date), not an overwrite.
      const [inserted] = await db
        .insert(contacts)
        .values({ userId, source })
        .onConflictDoNothing()
        .returning();
      if (inserted) return contactSchema.parse(inserted);

      const existing = await db.query.contacts.findFirst({ where: eq(contacts.userId, userId) });
      return contactSchema.parse(existing);
    },

    async getRegistryEntry(userId) {
      const row = await db.query.contacts.findFirst({ where: eq(contacts.userId, userId) });
      return row ? contactSchema.parse(row) : null;
    },

    async listTags(userId) {
      const rows = await db.query.contactTags.findMany({
        where: eq(contactTags.userId, userId),
        orderBy: [asc(contactTags.label)],
      });
      return rows.map((row) => contactTagSchema.parse(row));
    },

    async listTagsByUsers(userIds) {
      const rows = await inIdChunks(userIds, (chunk) =>
        db.query.contactTags.findMany({
          where: inArray(contactTags.userId, chunk),
          orderBy: [asc(contactTags.label)],
        }),
      );
      return rows.map((row) => contactTagSchema.parse(row));
    },

    async listAllLabels() {
      const rows = await db
        .selectDistinct({ label: contactTags.label })
        .from(contactTags)
        .orderBy(asc(contactTags.label));
      return rows.map((row) => row.label);
    },

    async addTag(userId, label) {
      const normalized = normalizeTagLabel(label);
      if (!normalized) throw new Error("A tag needs at least one character.");

      const [inserted] = await db
        .insert(contactTags)
        .values({ userId, label: normalized })
        .onConflictDoNothing()
        .returning();
      if (inserted) return contactTagSchema.parse(inserted);

      const existing = await db.query.contactTags.findFirst({
        where: and(eq(contactTags.userId, userId), eq(contactTags.label, normalized)),
      });
      return contactTagSchema.parse(existing);
    },

    async removeTag(userId, label) {
      const normalized = normalizeTagLabel(label);
      if (!normalized) return;
      await db
        .delete(contactTags)
        .where(and(eq(contactTags.userId, userId), eq(contactTags.label, normalized)));
    },

    async listNotes(userId) {
      const rows = await db.query.contactNotes.findMany({
        where: eq(contactNotes.userId, userId),
        orderBy: [desc(contactNotes.createdAt)],
      });
      return rows.map((row) => contactNoteSchema.parse(row));
    },

    async addNote(input: NewContactNote) {
      const [row] = await db.insert(contactNotes).values(input).returning();
      return contactNoteSchema.parse(row);
    },
  };
}
