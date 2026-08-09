import { describe, expect, it } from "vitest";
import {
  importProfilePatch,
  parseSpeakerCsv,
  summarizeImport,
  type SpeakerImportResultRow,
} from "@/domain/speaker-import";

const HEADER = "name,email,title,company,bio";

describe("parseSpeakerCsv", () => {
  it("reads the documented columns", () => {
    const { rows, problems } = parseSpeakerCsv(
      `${HEADER}\nAda Lovelace,ada@example.com,Analyst,Analytical Engines,Wrote the first program.`,
    );

    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        title: "Analyst",
        company: "Analytical Engines",
        bio: "Wrote the first program.",
        line: 2,
        duplicateLines: [],
      },
    ]);
  });

  it("accepts the columns in any order and ignores ones it has no home for", () => {
    const { rows, problems } = parseSpeakerCsv(
      "Email,Notes,Name,Company\nada@example.com,vip,Ada Lovelace,Analytical Engines",
    );

    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({
      email: "ada@example.com",
      name: "Ada Lovelace",
      company: "Analytical Engines",
      title: null,
      bio: null,
    });
  });

  it("leaves omitted trailing columns empty rather than failing the row", () => {
    const { rows, problems } = parseSpeakerCsv(`${HEADER}\nAda Lovelace,ada@example.com`);

    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ title: null, company: null, bio: null });
  });

  it("keeps commas and newlines that a quoted bio contains", () => {
    const { rows } = parseSpeakerCsv(
      `${HEADER}\nAda Lovelace,ada@example.com,,,"Analyst, poet.\nSays ""hello""."`,
    );

    expect(rows[0].bio).toBe('Analyst, poet.\nSays "hello".');
  });

  it("reports the header when a required column is missing", () => {
    const { rows, problems } = parseSpeakerCsv("name,company\nAda Lovelace,Analytical Engines");

    expect(rows).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("email");
  });

  it("reports malformed rows by line and imports the rest", () => {
    const { rows, problems } = parseSpeakerCsv(
      [
        HEADER,
        "Ada Lovelace,ada@example.com,,,",
        ",nobody@example.com,,,",
        "Grace Hopper,not-an-email,,,",
        "Alan Turing,,,,",
        "Katherine Johnson,katherine@example.com,Mathematician,NASA,Computed trajectories, by hand",
      ].join("\n"),
    );

    expect(rows.map((row) => row.email)).toEqual(["ada@example.com"]);
    expect(problems).toEqual([
      { line: 3, message: "No name for nobody@example.com." },
      { line: 4, message: `"not-an-email" isn't a valid email address.` },
      { line: 5, message: "No email — every speaker needs an address." },
      {
        line: 6,
        message: "More values than columns — check for a comma that needs quoting.",
      },
    ]);
  });

  it("merges duplicate addresses, filling blanks without overwriting", () => {
    const { rows, problems } = parseSpeakerCsv(
      [
        HEADER,
        "Ada Lovelace,ada@example.com,Analyst,,",
        "Ada L,ADA@example.com,Mathematician,Analytical Engines,A bio",
      ].join("\n"),
    );

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      title: "Analyst",
      company: "Analytical Engines",
      bio: "A bio",
      duplicateLines: [3],
    });
  });

  it("skips blank lines and trailing newlines", () => {
    const { rows, problems } = parseSpeakerCsv(
      `${HEADER}\n\nAda Lovelace,ada@example.com,,,\n\n`,
    );

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("reports an empty paste instead of importing nothing silently", () => {
    expect(parseSpeakerCsv("   \n").problems).toHaveLength(1);
  });
});

describe("importProfilePatch", () => {
  const blank = { name: null, title: null, company: null, bio: null };

  it("fills every empty field", () => {
    expect(
      importProfilePatch(blank, {
        name: "Ada Lovelace",
        title: "Analyst",
        company: "Analytical Engines",
        bio: "A bio",
      }),
    ).toEqual({
      name: "Ada Lovelace",
      title: "Analyst",
      company: "Analytical Engines",
      bio: "A bio",
    });
  });

  it("never overwrites what the speaker already has", () => {
    expect(
      importProfilePatch(
        { name: "Ada Lovelace", title: "Countess", company: "  ", bio: null },
        { name: "Ada L", title: "Analyst", company: "Analytical Engines", bio: null },
      ),
    ).toEqual({ company: "Analytical Engines" });
  });
});

describe("summarizeImport", () => {
  it("counts each outcome", () => {
    const rows: SpeakerImportResultRow[] = [
      { email: "a@example.com", name: "A", outcome: "created" },
      { email: "b@example.com", name: "B", outcome: "merged" },
      { email: "c@example.com", name: "C", outcome: "merged" },
      { email: "d@example.com", name: "D", outcome: "skipped", detail: "Already an admin" },
    ];

    expect(summarizeImport(rows)).toMatchObject({ created: 1, merged: 2, skipped: 1 });
  });
});
