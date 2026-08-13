import { describe, expect, it } from "vitest";
import { authorizeEvaluationAccess, type EvaluationAccessEnv } from "./evaluation-access";

const env: EvaluationAccessEnv = {
  EVALUATION_ACCESS_EXPIRES_AT: "2026-08-13T12:00:00.000Z",
  EVALUATION_ORGANIZER_EMAIL: "Organizer@Example.com ",
  EVALUATION_REVIEWER_EMAIL: "reviewer@example.com",
  EVALUATION_SPEAKER_EMAIL: "speaker@example.com",
};
const now = new Date("2026-08-12T12:00:00.000Z");

describe("authorizeEvaluationAccess", () => {
  it.each([
    ["organizer", "organizer@example.com", "admin"],
    ["reviewer", "reviewer@example.com", "reviewer"],
    ["speaker", "speaker@example.com", "speaker"],
  ] as const)("maps the fixed %s persona to its configured identity and role", (persona, email, role) => {
    expect(authorizeEvaluationAccess(env, { persona }, now)).toEqual({
      persona,
      email,
      expectedRole: role,
    });
  });

  it.each([
    ["unknown persona", { ...env }, { persona: "administrator" }],
    ["missing email", { ...env, EVALUATION_REVIEWER_EMAIL: undefined }, { persona: "organizer" }],
    ["invalid email", { ...env, EVALUATION_SPEAKER_EMAIL: "not-an-email" }, { persona: "organizer" }],
    ["duplicate email", { ...env, EVALUATION_SPEAKER_EMAIL: "reviewer@example.com" }, { persona: "organizer" }],
    ["missing expiry", { ...env, EVALUATION_ACCESS_EXPIRES_AT: undefined }, { persona: "organizer" }],
    ["invalid expiry", { ...env, EVALUATION_ACCESS_EXPIRES_AT: "tomorrow" }, { persona: "organizer" }],
    ["reviewer admin bootstrap collision", { ...env, ADMIN_EMAILS: "reviewer@example.com" }, { persona: "organizer" }],
    ["speaker admin bootstrap collision", { ...env, ADMIN_EMAILS: " other@example.com, SPEAKER@example.com " }, { persona: "organizer" }],
  ])("fails closed for %s", (_label, candidateEnv, input) => {
    expect(authorizeEvaluationAccess(candidateEnv, input, now)).toBeNull();
  });

  it("fails closed at and after the configured expiry", async () => {
    expect(
      authorizeEvaluationAccess(env, { persona: "speaker" }, new Date(env.EVALUATION_ACCESS_EXPIRES_AT!)),
    ).toBeNull();
  });
});
