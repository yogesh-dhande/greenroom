/**
 * The one email interface the whole app sends through (spec.md §7 —
 * communications "must actually work, no stubs", decisions.md D-017).
 *
 * Two transports implement `EmailSender`:
 *  - `createSendGridEmailSender` — production delivery via SendGrid's v3
 *    `mail/send` API (D-030; replaces the earlier Resend transport, D-001).
 *  - `createDevEmailSender` — development/verification: prints the complete
 *    message (headers, both bodies, attachment names) to the console and
 *    writes it to a gitignored folder so it can be opened and inspected.
 *
 * `createLoggingEmailSender` wraps either one so that every attempt lands in
 * `email_log` through the storage-agnostic repository layer — that table is
 * what backs the per-speaker communication log. It only ever sees the
 * `EmailLogRepo` *interface*, never a D1/Drizzle type.
 */
import type { EmailKind, EmailRelatedType } from "@/db/entities";
import type { EmailLogRepo } from "@/db/repos/email-log";

// ---------------------------------------------------------------------------
// Message shape
// ---------------------------------------------------------------------------

export interface EmailIdentity {
  name: string;
  email: string;
}

/** `Greenroom <hello@greenroom.dev>` — RFC 5322 mailbox form. */
export function formatIdentity(identity: EmailIdentity): string {
  return identity.name ? `${identity.name} <${identity.email}>` : identity.email;
}

export interface EmailAttachment {
  filename: string;
  /** UTF-8 text (we only ever attach text right now; R2 files are linked). */
  content: string;
  /** Full MIME type including parameters. */
  contentType: string;
}

/**
 * An iMIP calendar part (RFC 6047). Kept separate from `attachments` because
 * transports must give it a `text/calendar; method=…` content type rather
 * than deriving one from the filename — that content type is what makes
 * Outlook treat the part as an invitation rather than a file
 * (MS-STANOICAL §RFC6047 2.4).
 */
export interface CalendarPart {
  method: "REQUEST" | "CANCEL";
  filename: string;
  content: string;
  contentType: string;
}

/** What the send is *about*, so it can be written to `email_log`. */
export interface EmailLogContext {
  kind: EmailKind;
  relatedType?: EmailRelatedType | null;
  relatedId?: string | null;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always supplied — never let a client fall back to a
   * machine-stripped version of the HTML. */
  text: string;
  html: string;
  replyTo?: string;
  /**
   * Extra headers. Never set `Content-Type` here: SendGrid's `mail/send`
   * builds the MIME structure itself and its `headers` field explicitly
   * forbids overwriting `Content-Type` (also `To`/`From`/`Subject`/
   * `Reply-To`/`Cc`/`Bcc` — use the dedicated fields instead) — SendGrid Mail
   * Send API reference, `headers`; per-part types belong on
   * `attachments`/`calendar`.
   */
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  calendar?: CalendarPart;
  log?: EmailLogContext;
}

export interface SentEmail {
  id: string;
  /** Dev transport only: files written for inspection. */
  files?: string[];
}

export interface EmailSender {
  /** The From identity. Calendar invites set ORGANIZER to this so the
   * address a client sees and the address RSVPs are sent to agree. */
  readonly from: EmailIdentity;
  send(message: EmailMessage): Promise<SentEmail>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Base64 without depending on Node's Buffer (workerd has btoa, not Buffer
 * unless nodejs_compat is loaded in that bundle). */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function allAttachments(message: EmailMessage): EmailAttachment[] {
  const attachments = [...(message.attachments ?? [])];
  if (message.calendar) {
    attachments.unshift({
      filename: message.calendar.filename,
      content: message.calendar.content,
      contentType: message.calendar.contentType,
    });
  }
  return attachments;
}

// ---------------------------------------------------------------------------
// SendGrid transport
// ---------------------------------------------------------------------------

export interface SendGridSenderOptions {
  apiKey: string;
  from: EmailIdentity;
  /** Injectable for tests; defaults to the global `fetch` (native in
   * workerd and modern Node). */
  fetchImpl?: typeof fetch;
}

interface SendGridErrorBody {
  errors?: Array<{ message?: string }>;
}

/**
 * Production transport (D-030 — replaces Resend, D-001).
 *
 * Calendar invites go out as a single attachment carrying
 * `text/calendar; charset=utf-8; method=REQUEST` (decisions.md D-020).
 * SendGrid's v3 `mail/send` builds the MIME tree itself from `content`/
 * `attachments` — there is no raw-MIME endpoint — and exposes no way to add
 * a `text/calendar` sibling inside `multipart/alternative`, so this is the
 * strongest structure the API allows, and it is the one Outlook documents as
 * sufficient: Outlook 2010+ scans every child of `multipart/mixed` for iMIP
 * data and treats the first one it finds as the invitation (MS-STANOICAL
 * §RFC6047 2.4, V0343). The part doubles as the attachment fallback for
 * clients that only offer "download .ics", because RFC 6047 §2.6 requires
 * handling to key off Content-Type rather than the filename. `allAttachments`
 * unshifts the calendar part so it stays first.
 *
 * Two API-shape traps:
 *  - `content[]` must list `text/plain` before `text/html` — SendGrid
 *    rejects the request otherwise (Mail Send API reference, `content`).
 *  - each attachment's `content` is Base64 text — there is no separate
 *    encoding field, unlike a Buffer-accepting SDK.
 *
 * A 202 response has an empty body; the provider message id comes back in
 * the `x-message-id` response header (falls back to `""` if absent). Any
 * other status is an error: SendGrid's error body is
 * `{ errors: [{ message, field, help }] }`, so the message(s) are pulled out
 * of that shape when the body parses as JSON.
 */
export function createSendGridEmailSender({
  apiKey,
  from,
  fetchImpl = globalThis.fetch,
}: SendGridSenderOptions): EmailSender {
  return {
    from,
    async send(message) {
      const attachments = allAttachments(message);
      const body = {
        personalizations: [{ to: [{ email: message.to }] }],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        reply_to: message.replyTo ? { email: message.replyTo } : undefined,
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
        headers: message.headers,
        attachments: attachments.length
          ? attachments.map((attachment) => ({
              content: toBase64(attachment.content),
              type: attachment.contentType,
              filename: attachment.filename,
              disposition: "attachment",
            }))
          : undefined,
      };

      const response = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const raw = await response.text();
        let detail = raw;
        try {
          const parsed = JSON.parse(raw) as SendGridErrorBody;
          const messages = (parsed.errors ?? []).map((e) => e.message).filter(Boolean);
          if (messages.length) detail = messages.join("; ");
        } catch {
          // Body wasn't JSON (e.g. an HTML error page from a proxy) — the
          // raw text set above is the best we can surface.
        }
        throw new Error(`SendGrid send failed (${response.status}): ${detail}`);
      }

      return { id: response.headers.get("x-message-id") ?? "" };
    },
  };
}

// ---------------------------------------------------------------------------
// Development transport
// ---------------------------------------------------------------------------

/** Gitignored folder the dev transport writes rendered messages into. */
export const DEV_EMAIL_DIR = ".dev-emails";

export interface DevSenderOptions {
  from: EmailIdentity;
  /** Defaults to DEV_EMAIL_DIR, relative to the process working directory. */
  directory?: string;
  /** Set false to keep the console quiet (the verification script does). */
  echo?: boolean;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** The full message, rendered the way a maildrop would show it. */
function renderDevTranscript(from: EmailIdentity, message: EmailMessage, id: string): string {
  const headers: Array<[string, string]> = [
    ["Message-Id", id],
    ["Date", new Date().toISOString()],
    ["From", formatIdentity(from)],
    ["To", message.to],
    ["Subject", message.subject],
  ];
  if (message.replyTo) headers.push(["Reply-To", message.replyTo]);
  for (const [name, value] of Object.entries(message.headers ?? {})) headers.push([name, value]);
  if (message.log) {
    headers.push([
      "X-Greenroom-Log",
      `${message.log.kind}${message.log.relatedType ? ` ${message.log.relatedType}:${message.log.relatedId}` : ""}`,
    ]);
  }

  const parts = allAttachments(message).map(
    (attachment) =>
      `  - ${attachment.filename} (${attachment.contentType}, ${attachment.content.length} bytes)`,
  );

  const sections = [
    headers.map(([name, value]) => `${name}: ${value}`).join("\n"),
    `--- text/plain ---\n${message.text}`,
    `--- text/html ---\n${message.html}`,
  ];
  if (parts.length) sections.push(`--- attachments ---\n${parts.join("\n")}`);
  if (message.calendar) {
    sections.push(
      `--- ${message.calendar.contentType} ---\n${message.calendar.content.replace(/\r\n/g, "\n")}`,
    );
  }
  return `${sections.join("\n\n")}\n`;
}

/**
 * Development transport. Prints the complete message and writes it to
 * `.dev-emails/` (gitignored) so the rendered copy, the HTML, and any .ics
 * can actually be opened — the same idea as the magic-link capture in
 * src/lib/dev-magic-link.ts. `node:fs` is imported dynamically and failures
 * are swallowed, so this still works in a runtime without a filesystem.
 */
export function createDevEmailSender(options: DevSenderOptions): EmailSender {
  const directory = options.directory ?? DEV_EMAIL_DIR;
  const echo = options.echo ?? true;
  let counter = 0;

  return {
    from: options.from,
    async send(message) {
      const id = `dev-${Date.now().toString(36)}-${(counter += 1)}`;
      const transcript = renderDevTranscript(options.from, message, id);
      if (echo) console.log(`\n>> EMAIL (dev transport)\n${transcript}`);

      const files: string[] = [];
      try {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(directory, { recursive: true });
        const base = `${String(counter).padStart(2, "0")}-${slugify(message.log?.kind ?? message.subject)}`;
        const write = async (suffix: string, body: string) => {
          const path = `${directory}/${base}${suffix}`;
          await writeFile(path, body, "utf8");
          files.push(path);
        };
        await write(".txt", transcript);
        await write(".html", message.html);
        if (message.calendar) await write(".ics", message.calendar.content);
      } catch (error) {
        // Never let inspection plumbing break a send — the console copy above
        // is still there.
        console.warn(`Could not write dev email to ${directory}/:`, error);
      }

      return { id, files };
    },
  };
}

// ---------------------------------------------------------------------------
// email_log decorator
// ---------------------------------------------------------------------------

/**
 * Wraps a transport so every attempt is recorded in `email_log`
 * (spec.md §7 — "communication log per speaker"). Failures are logged with
 * `status: "failed"` and the error re-thrown; a failure to *write the log*
 * is warned about but never converts a delivered email into an error.
 *
 * Messages with no `log` context are passed through unrecorded, so a caller
 * has to opt out deliberately.
 */
export function createLoggingEmailSender(inner: EmailSender, emailLog: EmailLogRepo): EmailSender {
  return {
    from: inner.from,
    async send(message) {
      const record = async (status: "sent" | "failed", error: string | null) => {
        if (!message.log) return;
        try {
          await emailLog.create({
            to: message.to,
            subject: message.subject,
            kind: message.log.kind,
            relatedType: message.log.relatedType ?? null,
            relatedId: message.log.relatedId ?? null,
            status,
            error,
            sentAt: new Date(),
          });
        } catch (logError) {
          console.warn("Could not write email_log row:", logError);
        }
      };

      try {
        const result = await inner.send(message);
        await record("sent", null);
        return result;
      } catch (error) {
        await record("failed", error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Environment wiring
// ---------------------------------------------------------------------------

export interface EmailEnv {
  SENDGRID_API_KEY?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_FROM_ADDRESS?: string;
}

const DEFAULT_FROM: EmailIdentity = {
  name: "Greenroom",
  // Unlike Resend, SendGrid has no shared sandbox sender — every From
  // address must be verified in the SendGrid account before it can send.
  // This placeholder only ever ships with the dev transport; production
  // must set EMAIL_FROM_ADDRESS to a SendGrid-verified sender (D-030).
  email: "no-reply@greenroom.localhost",
};

export function resolveEmailIdentity(env: EmailEnv): EmailIdentity {
  return {
    name: env.EMAIL_FROM_NAME || DEFAULT_FROM.name,
    email: env.EMAIL_FROM_ADDRESS || DEFAULT_FROM.email,
  };
}

/** SendGrid when an API key is configured, otherwise the dev transport. */
export function getEmailSender(env: EmailEnv): EmailSender {
  const from = resolveEmailIdentity(env);
  return env.SENDGRID_API_KEY
    ? createSendGridEmailSender({ apiKey: env.SENDGRID_API_KEY, from })
    : createDevEmailSender({ from });
}
