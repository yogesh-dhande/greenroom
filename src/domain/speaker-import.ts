/**
 * Speaker CSV import (spec.md §5, decisions.md D-051): turning a pasted or
 * uploaded spreadsheet into the same "create or reuse by email" calls the
 * manual "Add speaker" dialog makes.
 *
 * Pure and storage-agnostic like the rest of src/domain — parsing, validation,
 * de-duplication and the result summary are all decided here, so the server
 * action is only the part that writes.
 */
import { z } from "zod";

/** The columns the importer understands. Order in the file is free; anything
 * else in the header is ignored rather than rejected — exports from other
 * tools carry columns we have no home for. */
export const SPEAKER_CSV_COLUMNS = ["name", "email", "title", "company", "bio"] as const;

export const SPEAKER_CSV_HEADER = SPEAKER_CSV_COLUMNS.join(",");

/** Required in every row (D-051): a person needs an address to be reachable
 * and a name to be credited. */
const REQUIRED_COLUMNS = ["name", "email"] as const;

export interface SpeakerImportRow {
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  /** 1-based line of the first record that produced this row. */
  line: number;
  /** Later lines with the same address, merged into this row. */
  duplicateLines: number[];
}

export interface SpeakerImportProblem {
  line: number;
  message: string;
}

export interface SpeakerCsvParse {
  rows: SpeakerImportRow[];
  /** Every line that couldn't be used, with why — reported rather than
   * thrown, so one bad row never costs the organizer the other fifty. */
  problems: SpeakerImportProblem[];
}

interface CsvRecord {
  fields: string[];
  line: number;
}

/**
 * RFC4180-ish reader: double quotes protect commas and newlines inside a
 * value (a bio routinely contains both), and a doubled quote inside a quoted
 * value is a literal one. Deliberately hand-rolled — a dependency for this is
 * more surface area than the twenty lines it saves.
 */
function readCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let field = "";
  let fields: string[] = [];
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;

  const endRecord = () => {
    fields.push(field);
    // A line of nothing but separators-free whitespace is spacing, not data.
    if (fields.some((value) => value.trim() !== "")) {
      records.push({ fields, line: recordLine });
    }
    fields = [];
    field = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line++;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else if (char === "\n") {
      endRecord();
      line++;
      recordLine = line;
    } else if (char !== "\r") {
      field += char;
    }
  }
  endRecord();

  return records;
}

/** Header cells normalized for matching: case, padding and a leading BOM
 * (what a spreadsheet export puts in front of the first column) all ignored. */
function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function cell(record: CsvRecord, index: number | undefined): string {
  if (index === undefined) return "";
  return (record.fields[index] ?? "").trim();
}

function optional(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Parses a CSV into importable rows.
 *
 * Rows with the same address are merged rather than imported twice: the first
 * occurrence sets the name, and later ones only fill fields it left blank —
 * two half-filled lines for the same person are a single speaker, and neither
 * line is authoritative enough to overwrite the other.
 */
export function parseSpeakerCsv(text: string): SpeakerCsvParse {
  const records = readCsvRecords(text);
  if (records.length === 0) {
    return { rows: [], problems: [{ line: 1, message: "That file is empty." }] };
  }

  const [header, ...dataRecords] = records;
  const columnIndex = new Map<string, number>();
  header.fields.forEach((raw, index) => {
    const name = normalizeHeader(raw);
    if ((SPEAKER_CSV_COLUMNS as readonly string[]).includes(name) && !columnIndex.has(name)) {
      columnIndex.set(name, index);
    }
  });

  const missing = REQUIRED_COLUMNS.filter((name) => !columnIndex.has(name));
  if (missing.length > 0) {
    return {
      rows: [],
      problems: [
        {
          line: header.line,
          message: `The header row needs a ${missing.join(" and ")} column. Expected: ${SPEAKER_CSV_HEADER}`,
        },
      ],
    };
  }

  const problems: SpeakerImportProblem[] = [];
  const rowsByEmail = new Map<string, SpeakerImportRow>();

  for (const record of dataRecords) {
    // More values than columns almost always means an unquoted comma, which
    // has shifted every value after it — importing that would write garbage.
    if (record.fields.length > header.fields.length) {
      problems.push({
        line: record.line,
        message: "More values than columns — check for a comma that needs quoting.",
      });
      continue;
    }

    const email = cell(record, columnIndex.get("email")).toLowerCase();
    const name = cell(record, columnIndex.get("name"));
    if (!email) {
      problems.push({ line: record.line, message: "No email — every speaker needs an address." });
      continue;
    }
    if (!z.email().safeParse(email).success) {
      problems.push({ line: record.line, message: `"${email}" isn't a valid email address.` });
      continue;
    }
    if (!name) {
      problems.push({ line: record.line, message: `No name for ${email}.` });
      continue;
    }

    const title = optional(cell(record, columnIndex.get("title")));
    const company = optional(cell(record, columnIndex.get("company")));
    const bio = optional(cell(record, columnIndex.get("bio")));

    const existing = rowsByEmail.get(email);
    if (existing) {
      existing.duplicateLines.push(record.line);
      existing.title ??= title;
      existing.company ??= company;
      existing.bio ??= bio;
      continue;
    }

    rowsByEmail.set(email, {
      name,
      email,
      title,
      company,
      bio,
      line: record.line,
      duplicateLines: [],
    });
  }

  return { rows: [...rowsByEmail.values()], problems };
}

// ---------------------------------------------------------------------------
// Import results
// ---------------------------------------------------------------------------

/**
 * What happened to one row. `merged` means the address already had an
 * account — the same reuse the manual add does — so the import filled in
 * whatever the record was missing instead of creating a second person.
 */
export type SpeakerImportOutcome = "created" | "merged" | "skipped";

export interface SpeakerImportResultRow {
  email: string;
  name: string;
  outcome: SpeakerImportOutcome;
  /** Why it was skipped, or what merging changed. */
  detail?: string;
}

export interface SpeakerImportSummary {
  rows: SpeakerImportResultRow[];
  created: number;
  merged: number;
  skipped: number;
}

export function summarizeImport(rows: SpeakerImportResultRow[]): SpeakerImportSummary {
  return {
    rows,
    created: rows.filter((row) => row.outcome === "created").length,
    merged: rows.filter((row) => row.outcome === "merged").length,
    skipped: rows.filter((row) => row.outcome === "skipped").length,
  };
}

/** The profile fields an import may write onto an account that already exists. */
export type ImportableProfile = {
  name: string | null;
  title: string | null;
  company: string | null;
  bio: string | null;
};

/**
 * What to change on an existing account: blanks only.
 *
 * A spreadsheet is rarely fresher than what the speaker last saved on their
 * own profile (spec.md §6), so an import fills gaps and never overwrites —
 * an organizer who does want to correct a value edits the record page, where
 * the change is deliberate.
 */
export function importProfilePatch(
  existing: ImportableProfile,
  row: Pick<SpeakerImportRow, "name" | "title" | "company" | "bio">,
): Partial<ImportableProfile> {
  const patch: Partial<ImportableProfile> = {};
  if (!existing.name?.trim() && row.name) patch.name = row.name;
  if (!existing.title?.trim() && row.title) patch.title = row.title;
  if (!existing.company?.trim() && row.company) patch.company = row.company;
  if (!existing.bio?.trim() && row.bio) patch.bio = row.bio;
  return patch;
}
