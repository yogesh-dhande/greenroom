import { describe, expect, it } from "vitest";
import { authorizeEvaluationAccess, type EvaluationAccessEnv } from "./evaluation-access";

const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const env: EvaluationAccessEnv = {
  EVALUATION_ACCESS_TOKEN: token,
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
  ] as const)("maps the fixed %s persona to its configured identity and role", async (persona, email, role) => {
    await expect(authorizeEvaluationAccess(env, { persona, token }, now)).resolves.toEqual({
      persona,
      email,
      expectedRole: role,
    });
  });

  it.each([
    ["wrong token", { ...env }, { persona: "organizer", token: `${token}x` }],
    ["unknown persona", { ...env }, { persona: "administrator", token }],
    ["missing token", { ...env, EVALUATION_ACCESS_TOKEN: undefined }, { persona: "organizer", token }],
    ["short token", { ...env, EVALUATION_ACCESS_TOKEN: "too-short" }, { persona: "organizer", token: "too-short" }],
    ["missing email", { ...env, EVALUATION_REVIEWER_EMAIL: undefined }, { persona: "organizer", token }],
    ["invalid email", { ...env, EVALUATION_SPEAKER_EMAIL: "not-an-email" }, { persona: "organizer", token }],
    ["duplicate email", { ...env, EVALUATION_SPEAKER_EMAIL: "reviewer@example.com" }, { persona: "organizer", token }],
    ["invalid expiry", { ...env, EVALUATION_ACCESS_EXPIRES_AT: "tomorrow" }, { persona: "organizer", token }],
    ["reviewer admin bootstrap collision", { ...env, ADMIN_EMAILS: "reviewer@example.com" }, { persona: "organizer", token }],
    ["speaker admin bootstrap collision", { ...env, ADMIN_EMAILS: " other@example.com, SPEAKER@example.com " }, { persona: "organizer", token }],
  ])("fails closed for %s", async (_label, candidateEnv, input) => {
    await expect(authorizeEvaluationAccess(candidateEnv, input, now)).resolves.toBeNull();
  });

  it("fails closed at and after the configured expiry", async () => {
    await expect(
      authorizeEvaluationAccess(env, { persona: "speaker", token }, new Date(env.EVALUATION_ACCESS_EXPIRES_AT!)),
    ).resolves.toBeNull();
  });
});
