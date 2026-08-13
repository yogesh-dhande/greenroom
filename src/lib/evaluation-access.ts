import { z } from "zod";
import type { Role } from "@/db/entities";

export const EVALUATION_PERSONAS = ["organizer", "reviewer", "speaker"] as const;
export type EvaluationPersona = (typeof EVALUATION_PERSONAS)[number];

export interface EvaluationAccessEnv {
  ADMIN_EMAILS?: string;
  EVALUATION_ACCESS_TOKEN?: string;
  EVALUATION_ACCESS_EXPIRES_AT?: string;
  EVALUATION_ORGANIZER_EMAIL?: string;
  EVALUATION_REVIEWER_EMAIL?: string;
  EVALUATION_SPEAKER_EMAIL?: string;
}

export interface EvaluationAccessGrant {
  persona: EvaluationPersona;
  email: string;
  expectedRole: Role;
}

const MINIMUM_TOKEN_LENGTH = 43;
const personaSchema = z.enum(EVALUATION_PERSONAS);
const emailSchema = z.email();
const expirySchema = z.iso.datetime({ offset: true });

const PERSONA_FIELDS: Record<
  EvaluationPersona,
  { email: keyof EvaluationAccessEnv; role: Role }
> = {
  organizer: { email: "EVALUATION_ORGANIZER_EMAIL", role: "admin" },
  reviewer: { email: "EVALUATION_REVIEWER_EMAIL", role: "reviewer" },
  speaker: { email: "EVALUATION_SPEAKER_EMAIL", role: "speaker" },
};

async function secretsEqual(candidate: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const candidateBytes = new Uint8Array(candidateHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < candidateBytes.length; index += 1) {
    difference |= candidateBytes[index]! ^ expectedBytes[index]!;
  }
  return difference === 0;
}

/**
 * Resolves one of the three fixed evaluation personas without accepting an
 * email, user id, role, or redirect from the caller. The feature is enabled
 * only while every env value is valid and its global expiry is in the future.
 */
export async function authorizeEvaluationAccess(
  env: EvaluationAccessEnv,
  input: { persona?: unknown; token?: unknown },
  now = new Date(),
): Promise<EvaluationAccessGrant | null> {
  const persona = personaSchema.safeParse(input.persona);
  if (!persona.success || typeof input.token !== "string") return null;

  const configuredToken = env.EVALUATION_ACCESS_TOKEN?.trim();
  if (
    !configuredToken ||
    configuredToken.length < MINIMUM_TOKEN_LENGTH ||
    configuredToken.length > 512 ||
    input.token.length > 512
  ) {
    return null;
  }

  const expiresAt = env.EVALUATION_ACCESS_EXPIRES_AT?.trim();
  if (!expiresAt || !expirySchema.safeParse(expiresAt).success) return null;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) return null;

  const emails = Object.fromEntries(
    EVALUATION_PERSONAS.map((entry) => {
      const value = env[PERSONA_FIELDS[entry].email]?.trim().toLowerCase() ?? "";
      return [entry, value];
    }),
  ) as Record<EvaluationPersona, string>;
  if (EVALUATION_PERSONAS.some((entry) => !emailSchema.safeParse(emails[entry]).success)) {
    return null;
  }
  if (new Set(Object.values(emails)).size !== EVALUATION_PERSONAS.length) return null;

  // The normal session-create hook promotes ADMIN_EMAILS. Refuse a
  // misconfiguration that would let creating the Reviewer or Speaker session
  // change its role after the exact-role check below.
  const adminBootstrapEmails = new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    adminBootstrapEmails.has(emails.reviewer) ||
    adminBootstrapEmails.has(emails.speaker)
  ) {
    return null;
  }

  if (!(await secretsEqual(input.token, configuredToken))) return null;

  const config = PERSONA_FIELDS[persona.data];
  return {
    persona: persona.data,
    email: emails[persona.data],
    expectedRole: config.role,
  };
}
