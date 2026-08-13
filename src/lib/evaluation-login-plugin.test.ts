import { describe, expect, it } from "vitest";
import type { User } from "better-auth";
import type { EvaluationAccessGrant } from "./evaluation-access";
import { evaluationLoginPlugin, isExpectedEvaluationUser } from "./evaluation-login-plugin";

const grant: EvaluationAccessGrant = {
  persona: "reviewer",
  email: "reviewer@example.com",
  expectedRole: "reviewer",
};
const user = {
  id: "user-1",
  email: "reviewer@example.com",
  emailVerified: true,
  name: "Review Person",
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  role: "reviewer",
} satisfies User & { role: string };

describe("evaluationLoginPlugin", () => {
  it("registers a POST-only, header-required, CSRF-protected endpoint", () => {
    const plugin = evaluationLoginPlugin({});
    const endpoint = plugin.endpoints?.evaluationLogin;
    expect(endpoint?.path).toBe("/evaluation-login");
    expect(endpoint?.options).toMatchObject({ method: "POST", requireHeaders: true });
    expect(endpoint?.options.use?.length).toBeGreaterThan(0);
    expect(plugin.rateLimit?.[0]).toMatchObject({ window: 60, max: 120 });
  });

  it("accepts only the fixed persona field at the HTTP boundary", () => {
    const endpoint = evaluationLoginPlugin({}).endpoints?.evaluationLogin;
    const body = endpoint?.options.body;
    expect(body?.["~standard"].validate({ persona: "organizer" })).toMatchObject({ value: { persona: "organizer" } });
    expect(body?.["~standard"].validate({ persona: "organizer", email: "other@example.com" })).toMatchObject({ issues: expect.any(Array) });
    expect(body?.["~standard"].validate({ persona: "administrator" })).toMatchObject({ issues: expect.any(Array) });
  });

  it("accepts only a verified existing user with the exact configured email and role", () => {
    expect(isExpectedEvaluationUser(user, grant)).toBe(true);
    expect(isExpectedEvaluationUser({ ...user, emailVerified: false }, grant)).toBe(false);
    expect(isExpectedEvaluationUser({ ...user, email: "other@example.com" }, grant)).toBe(false);
    expect(isExpectedEvaluationUser({ ...user, role: "admin" }, grant)).toBe(false);
    expect(isExpectedEvaluationUser(null, grant)).toBe(false);
  });
});
