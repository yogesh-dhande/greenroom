import type {
  EmailKind,
  EmailLog,
  EmailLogStatus,
  EmailRelatedType,
  NewEmailLog,
} from "@/db/entities";

/** Narrowing for `count` — every field is ANDed, omitted fields are wildcards. */
export interface EmailLogFilter {
  to?: string;
  kind?: EmailKind;
  relatedType?: EmailRelatedType;
  relatedId?: string;
  status?: EmailLogStatus;
  /** Only rows sent at or after this instant. */
  sentSince?: Date;
}

export interface EmailLogRepo {
  /** Communication log per speaker (spec.md §7), keyed by email address so
   * it survives a speaker never claiming their account. */
  listByRecipient(email: string): Promise<EmailLog[]>;
  listByRelated(relatedType: EmailRelatedType, relatedId: string): Promise<EmailLog[]>;
  /** Newest first — backs the admin Communications view. */
  listRecent(limit: number): Promise<EmailLog[]>;
  /**
   * How many logged sends match `filter`. Two callers depend on it
   * (src/domain/comms.ts):
   *  - the .ics SEQUENCE for a session invite, counted from the recipient's
   *    prior invites for that session, so a re-send updates the existing
   *    calendar entry instead of duplicating it (decisions.md D-003);
   *  - reminder idempotency — "did we already nudge this assignment inside
   *    the current window?" (decisions.md D-013).
   */
  count(filter: EmailLogFilter): Promise<number>;
  create(input: NewEmailLog): Promise<EmailLog>;
}
