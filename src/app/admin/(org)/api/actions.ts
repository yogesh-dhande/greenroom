"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { getApiCredentialAdminService } from "./credential-service";
import type {
  CreateApiCredentialInput,
  CreateApiCredentialResult,
  RevokeApiCredentialResult,
} from "./types";

const PAGE_PATH = "/admin/api";

const createInputSchema = z
  .object({
    label: z.string().trim().min(1, "Enter a label").max(80, "Keep the label under 80 characters"),
    permission: z.enum(["read", "write"]),
    eventAccess: z.enum(["all", "selected"]),
    eventIds: z.array(z.string().min(1).max(128)).max(500),
    expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  })
  .superRefine((value, context) => {
    if (value.eventAccess === "selected" && value.eventIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["eventIds"],
        message: "Choose at least one event",
      });
    }
  });

const credentialIdSchema = z.string().min(1).max(128);

export async function createApiCredential(
  input: CreateApiCredentialInput,
): Promise<CreateApiCredentialResult> {
  const user = await requireAdmin(PAGE_PATH);
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details" };
  }

  // Duplicate ids are harmless but keeping one copy makes the credential's
  // displayed event access match the organizer's choices exactly.
  const eventIds = [...new Set(parsed.data.eventIds)];
  try {
    const service = await getApiCredentialAdminService();
    const data = await service.createCredential(user.id, { ...parsed.data, eventIds });
    revalidatePath(PAGE_PATH);
    return { ok: true, data };
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("selected events no longer exists")
        ? error.message
        : "Couldn't create the API key — try again";
    return { ok: false, error: message };
  }
}

export async function revokeApiCredential(id: string): Promise<RevokeApiCredentialResult> {
  const user = await requireAdmin(PAGE_PATH);
  const parsed = credentialIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "That API key is invalid" };

  try {
    const service = await getApiCredentialAdminService();
    await service.revokeCredential(user.id, parsed.data);
    revalidatePath(PAGE_PATH);
    return { ok: true, data: { id: parsed.data } };
  } catch {
    return { ok: false, error: "Couldn't revoke the API key — refresh and try again" };
  }
}
