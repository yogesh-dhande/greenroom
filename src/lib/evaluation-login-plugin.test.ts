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
  });

  it("accepts only a verified existing user with the exact configured email and role", () => {
    expect(isExpectedEvaluationUser(user, grant)).toBe(true);
    expect(isExpectedEvaluationUser({ ...user, emailVerified: false }, grant)).toBe(false);
    expect(isExpectedEvaluationUser({ ...user, email: "other@example.com" }, grant)).toBe(false);
    expect(isExpectedEvaluationUser({ ...user, role: "admin" }, grant)).toBe(false);
    expect(isExpectedEvaluationUser(null, grant)).toBe(false);
  });
});
