import { describe, expect, it } from "vitest";
import {
  checkRoleChange,
  decideAdminBootstrap,
  normalizeEmail,
  parseAdminEmails,
  planInvite,
} from "@/domain/team";

describe("parseAdminEmails", () => {
  it("returns nothing for an unset or blank variable", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails(null)).toEqual([]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails("   ")).toEqual([]);
  });

  it("splits, trims, lowercases, and drops empty slots", () => {
    expect(parseAdminEmails(" Ada@Example.com , bo@example.com ,, ")).toEqual([
      "ada@example.com",
      "bo@example.com",
    ]);
  });

  it("de-duplicates addresses that differ only by case or padding", () => {
    expect(parseAdminEmails("ada@example.com,ADA@EXAMPLE.COM, ada@example.com")).toEqual([
      "ada@example.com",
    ]);
  });
});

describe("decideAdminBootstrap", () => {
  const base = { adminEmails: ["ada@example.com"] } as const;

  it("promotes an address listed in ADMIN_EMAILS", () => {
    expect(decideAdminBootstrap({ ...base, email: "ada@example.com", role: "speaker" })).toEqual({
      promote: true,
      reason: "admin_emails",
    });
  });

  it("matches ADMIN_EMAILS case-insensitively and ignores surrounding space", () => {
    expect(decideAdminBootstrap({ ...base, email: "  Ada@Example.COM ", role: "reviewer" })).toEqual(
      { promote: true, reason: "admin_emails" },
    );
  });

  it("leaves an existing admin alone", () => {
    expect(decideAdminBootstrap({ ...base, email: "ada@example.com", role: "admin" })).toEqual({
      promote: false,
      reason: "already_admin",
    });
  });

  it("promotes nobody when ADMIN_EMAILS is unset, even on an instance with no admin (D-043)", () => {
    expect(
      decideAdminBootstrap({ email: "someone@example.com", role: "speaker", adminEmails: [] }),
    ).toEqual({ promote: false, reason: "not_eligible" });
  });

  it("does not promote a speaker who merely resembles a listed address", () => {
    expect(
      decideAdminBootstrap({ ...base, email: "ada@example.com.evil.test", role: "speaker" }),
    ).toEqual({ promote: false, reason: "not_eligible" });
  });

  it("re-promotes a listed address that was demoted by hand", () => {
    expect(
      decideAdminBootstrap({ email: "ada@example.com", role: "reviewer", adminEmails: ["ada@example.com"] })
        .promote,
    ).toBe(true);
  });
});

describe("checkRoleChange", () => {
  it("treats re-selecting the current role as a no-op success", () => {
    expect(
      checkRoleChange({
        adminIds: ["u1"],
        targetId: "u1",
        targetRole: "admin",
        nextRole: "admin",
        targetLabel: "Ada",
      }),
    ).toEqual({ ok: true, changed: false });
  });

  it("allows promoting a speaker or reviewer", () => {
    expect(
      checkRoleChange({
        adminIds: ["u1"],
        targetId: "u2",
        targetRole: "speaker",
        nextRole: "reviewer",
        targetLabel: "Bo",
      }),
    ).toEqual({ ok: true, changed: true });
  });

  it("refuses to demote the only admin", () => {
    const result = checkRoleChange({
      adminIds: ["u1"],
      targetId: "u1",
      targetRole: "admin",
      nextRole: "speaker",
      targetLabel: "Ada",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("only admin");
  });

  it("refuses to demote the only admin even to reviewer", () => {
    expect(
      checkRoleChange({
        adminIds: ["u1"],
        targetId: "u1",
        targetRole: "admin",
        nextRole: "reviewer",
        targetLabel: "Ada",
      }).ok,
    ).toBe(false);
  });

  it("allows demoting an admin while another admin remains", () => {
    expect(
      checkRoleChange({
        adminIds: ["u1", "u2"],
        targetId: "u1",
        targetRole: "admin",
        nextRole: "speaker",
        targetLabel: "Ada",
      }),
    ).toEqual({ ok: true, changed: true });
  });

  it("refuses when the admin list somehow omits the target and is otherwise empty", () => {
    // Defensive: a stale list must fail closed, not open.
    expect(
      checkRoleChange({
        adminIds: [],
        targetId: "u1",
        targetRole: "admin",
        nextRole: "speaker",
        targetLabel: "Ada",
      }).ok,
    ).toBe(false);
  });
});

describe("planInvite", () => {
  it("creates a row when the address has no account", () => {
    expect(planInvite({ email: " New@Example.com ", role: "reviewer", existing: null })).toEqual({
      action: "create",
      email: "new@example.com",
      role: "reviewer",
    });
  });

  it("changes the role of an existing account", () => {
    expect(
      planInvite({
        email: "bo@example.com",
        role: "admin",
        existing: { id: "u2", role: "speaker" },
      }),
    ).toEqual({
      action: "change_role",
      email: "bo@example.com",
      role: "admin",
      userId: "u2",
      currentRole: "speaker",
    });
  });

  it("does nothing when the account already has that role", () => {
    expect(
      planInvite({
        email: "bo@example.com",
        role: "reviewer",
        existing: { id: "u2", role: "reviewer" },
      }),
    ).toEqual({ action: "none", email: "bo@example.com", role: "reviewer", userId: "u2" });
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ada@Example.COM  ")).toBe("ada@example.com");
  });
});
