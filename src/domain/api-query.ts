/** Pure collection filtering, sorting and pagination for API list DTOs. */
import { z } from "zod";

import type {
  ApiPagination,
  ApiSessionList,
  ApiSpeakerList,
  ApiSubmissionList,
} from "@/domain/api-dtos";

export const DEFAULT_API_PAGE = 1;
export const DEFAULT_API_PAGE_SIZE = 25;
export const MAX_API_PAGE_SIZE = 100;

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalBoolean = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean().optional());

export const collectionQueryShape = {
  page: z.coerce.number().int().positive().default(DEFAULT_API_PAGE),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_API_PAGE_SIZE)
    .default(DEFAULT_API_PAGE_SIZE),
  query: optionalTrimmedString,
  sort: z.enum(["createdAt", "updatedAt", "title"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
};

export const collectionQuerySchema = z.object(collectionQueryShape).strict();
export type CollectionQuery = z.infer<typeof collectionQuerySchema>;

export const sessionCollectionQuerySchema = z
  .object({
    ...collectionQueryShape,
    status: z.enum(["draft", "confirmed", "cancelled"]).optional(),
    contentStatus: z.enum(["draft", "in_review", "approved"]).optional(),
    track: optionalTrimmedString,
    room: optionalTrimmedString,
    scheduled: optionalBoolean,
  })
  .strict();
export type SessionCollectionQuery = z.infer<typeof sessionCollectionQuerySchema>;

export const speakerCollectionQuerySchema = z
  .object({
    ...collectionQueryShape,
    confirmation: z.enum(["unconfirmed", "confirmed", "declined"]).optional(),
  })
  .strict();
export type SpeakerCollectionQuery = z.infer<typeof speakerCollectionQuerySchema>;

export const submissionCollectionQuerySchema = z
  .object({
    ...collectionQueryShape,
    status: z
      .enum(["draft", "submitted", "approved", "maybe", "denied", "withdrawn"])
      .optional(),
    form: optionalTrimmedString,
    track: optionalTrimmedString,
  })
  .strict();
export type SubmissionCollectionQuery = z.infer<typeof submissionCollectionQuerySchema>;

type QueryInput = URLSearchParams | Record<string, string | string[] | undefined>;

function queryRecord(input: QueryInput): Record<string, string | string[] | undefined> {
  if (!(input instanceof URLSearchParams)) return input;
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(input.keys())) {
    const values = input.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}

export function parseCollectionQuery<S extends z.ZodType>(
  schema: S,
  input: QueryInput,
): z.infer<S> {
  return schema.parse(queryRecord(input));
}

interface SortableApiRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  title?: string | null;
  name?: string | null;
}

export function sortCollection<T extends SortableApiRecord>(
  records: readonly T[],
  sort: CollectionQuery["sort"] = "updatedAt",
  direction: CollectionQuery["direction"] = "desc",
): T[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...records].sort((left, right) => {
    const leftValue =
      sort === "title" ? (left.title ?? left.name ?? "").toLocaleLowerCase() : left[sort];
    const rightValue =
      sort === "title" ? (right.title ?? right.name ?? "").toLocaleLowerCase() : right[sort];
    const primary = leftValue.localeCompare(rightValue) * multiplier;
    return primary === 0 ? left.id.localeCompare(right.id) : primary;
  });
}

export interface PaginatedCollection<T> {
  data: T[];
  pagination: ApiPagination;
}

export function paginateCollection<T>(
  records: readonly T[],
  page: number = DEFAULT_API_PAGE,
  pageSize: number = DEFAULT_API_PAGE_SIZE,
): PaginatedCollection<T> {
  const total = records.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  return {
    data: records.slice(offset, offset + pageSize),
    pagination: { page, pageSize, total, totalPages },
  };
}

function includesFold(value: string | null | undefined, query: string): boolean {
  return (value ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function finishCollection<T extends SortableApiRecord>(
  records: readonly T[],
  query: Pick<CollectionQuery, "page" | "pageSize" | "sort" | "direction">,
): PaginatedCollection<T> {
  return paginateCollection(
    sortCollection(records, query.sort, query.direction),
    query.page,
    query.pageSize,
  );
}

export function applySessionCollectionQuery(
  records: readonly ApiSessionList[],
  query: SessionCollectionQuery,
): PaginatedCollection<ApiSessionList> {
  const filtered = records.filter((session) => {
    if (
      query.query &&
      !includesFold(session.title, query.query) &&
      !session.speakers.some((speaker) =>
        [speaker.name, speaker.title, speaker.company].some((value) =>
          includesFold(value, query.query!),
        ),
      )
    ) {
      return false;
    }
    if (query.status && session.status !== query.status) return false;
    if (query.contentStatus && session.contentStatus !== query.contentStatus) return false;
    if (query.track && session.track?.id !== query.track) return false;
    if (query.room && session.room?.id !== query.room) return false;
    if (query.scheduled !== undefined) {
      const scheduled = session.schedulingStatus === "scheduled";
      if (scheduled !== query.scheduled) return false;
    }
    return true;
  });
  return finishCollection(filtered, query);
}

export function applySpeakerCollectionQuery(
  records: readonly ApiSpeakerList[],
  query: SpeakerCollectionQuery,
): PaginatedCollection<ApiSpeakerList> {
  const filtered = records.filter((speaker) => {
    if (
      query.query &&
      ![speaker.name, speaker.title, speaker.company].some((value) =>
        includesFold(value, query.query!),
      )
    ) {
      return false;
    }
    return !query.confirmation || speaker.confirmationStatus === query.confirmation;
  });
  return finishCollection(filtered, query);
}

export function applySubmissionCollectionQuery(
  records: readonly ApiSubmissionList[],
  query: SubmissionCollectionQuery,
): PaginatedCollection<ApiSubmissionList> {
  const filtered = records.filter((submission) => {
    if (
      query.query &&
      !includesFold(submission.title, query.query) &&
      !submission.speakers.some((speaker) => includesFold(speaker.name, query.query!))
    ) {
      return false;
    }
    if (query.status && submission.status !== query.status) return false;
    if (query.form && submission.formId !== query.form) return false;
    if (query.track && !submission.tracks.some((track) => track.id === query.track)) return false;
    return true;
  });
  return finishCollection(filtered, query);
}
