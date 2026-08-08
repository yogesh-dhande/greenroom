import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Standards-based calendar invite attachment (decisions.md D-003). */
  icsAttachment?: { filename: string; content: string };
}

export interface EmailSender {
  send(input: SendEmailInput): Promise<{ id: string }>;
}

/**
 * Resend-backed sender for production. Requires RESEND_API_KEY (see
 * .env.example). Magic-link emails (better-auth), templated speaker
 * communications, and reminders (spec.md §3) all funnel through this.
 */
export function createResendEmailSender(apiKey: string): EmailSender {
  const resend = new Resend(apiKey);
  return {
    async send(input) {
      const { data, error } = await resend.emails.send({
        from: "Greenroom <onboarding@resend.dev>",
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.icsAttachment
          ? [
              {
                filename: input.icsAttachment.filename,
                content: input.icsAttachment.content,
              },
            ]
          : undefined,
      });
      if (error) throw new Error(`Resend send failed: ${error.message}`);
      return { id: data?.id ?? "" };
    },
  };
}

/** Dev/test stub — logs instead of calling the Resend API. */
export function createStubEmailSender(): EmailSender {
  return {
    async send(input) {
      const id = crypto.randomUUID();
      console.log("[stub email]", {
        id,
        to: input.to,
        subject: input.subject,
        hasIcs: Boolean(input.icsAttachment),
      });
      return { id };
    },
  };
}

/** Picks the Resend sender when RESEND_API_KEY is set, else the dev stub. */
export function getEmailSender(env: { RESEND_API_KEY?: string }): EmailSender {
  return env.RESEND_API_KEY
    ? createResendEmailSender(env.RESEND_API_KEY)
    : createStubEmailSender();
}
