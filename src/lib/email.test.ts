import { describe, expect, it, vi } from "vitest";
import {
  createSendGridEmailSender,
  getEmailSender,
  MISSING_API_KEY_ERROR,
  toBase64,
  type EmailIdentity,
  type EmailMessage,
} from "@/lib/email";

const FROM: EmailIdentity = { name: "Greenroom", email: "no-reply@greenroom.localhost" };

function baseMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: "priya@example.com",
    subject: "You're in — Retrieval that survives production traffic",
    text: "Plain body",
    html: "<p>HTML body</p>",
    ...overrides,
  };
}

/** A fetch stub that records the request and returns a canned response. */
function stubFetch(response: { status: number; headers?: Record<string, string>; body?: string }) {
  // The parameters exist so `mock.calls` carries the request the assertions
  // read; the stub body itself never looks at them.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(response.body ?? "", {
      status: response.status,
      headers: response.headers,
    });
  });
}

type FetchMock = ReturnType<typeof stubFetch>;

/** Builds a sender wired to the stub, casting past the Cloudflare-flavoured
 * `RequestInit` overloads that `typeof fetch` carries in this project. */
function makeSender(fetchImpl: FetchMock, from: EmailIdentity = FROM) {
  return createSendGridEmailSender({
    apiKey: "sg-key",
    from,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

function sentBody(fetchImpl: FetchMock): Record<string, unknown> {
  const [, init] = fetchImpl.mock.calls[0];
  return JSON.parse((init as RequestInit).body as string);
}

describe("createSendGridEmailSender — request shape", () => {
  it("posts to the v3 mail/send endpoint with a bearer token", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(baseMessage());

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sg-key");
  });

  it("lists text/plain before text/html — SendGrid rejects the reverse order", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(baseMessage());

    const body = sentBody(fetchImpl);
    const content = body.content as Array<{ type: string; value: string }>;
    expect(content).toEqual([
      { type: "text/plain", value: "Plain body" },
      { type: "text/html", value: "<p>HTML body</p>" },
    ]);
  });

  it("omits the from name when empty", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl, { name: "", email: "hello@greenroom.dev" }).send(baseMessage());

    const body = sentBody(fetchImpl);
    expect(body.from).toEqual({ email: "hello@greenroom.dev" });
  });

  it("includes the from name when set", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(baseMessage());

    const body = sentBody(fetchImpl);
    expect(body.from).toEqual({ email: "no-reply@greenroom.localhost", name: "Greenroom" });
  });

  it("passes reply_to and custom headers through when set", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(
      baseMessage({
        replyTo: "organizer@greenroom.dev",
        headers: { "X-Greenroom-Log": "task-reminder" },
      }),
    );

    const body = sentBody(fetchImpl);
    expect(body.reply_to).toEqual({ email: "organizer@greenroom.dev" });
    expect(body.headers).toEqual({ "X-Greenroom-Log": "task-reminder" });
  });

  it("omits reply_to and headers when not set", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(baseMessage());

    const body = sentBody(fetchImpl);
    expect(body.reply_to).toBeUndefined();
    expect(body.headers).toBeUndefined();
  });

  it("addresses only the single recipient via personalizations", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(baseMessage({ to: "speaker@example.com" }));

    const body = sentBody(fetchImpl);
    expect(body.personalizations).toEqual([{ to: [{ email: "speaker@example.com" }] }]);
  });
});

describe("createSendGridEmailSender — attachments and the calendar part", () => {
  it("puts the calendar part first with SendGrid's required bare MIME type", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    const icsContent = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n";
    await makeSender(fetchImpl).send(
      baseMessage({
        calendar: {
          method: "REQUEST",
          filename: "invite.ics",
          content: icsContent,
          contentType: "text/calendar; charset=utf-8; method=REQUEST",
        },
        attachments: [{ filename: "notes.txt", content: "some notes", contentType: "text/plain" }],
      }),
    );

    const body = sentBody(fetchImpl);
    const attachments = body.attachments as Array<{
      content: string;
      type: string;
      filename: string;
      disposition: string;
    }>;
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toEqual({
      content: toBase64(icsContent),
      type: "text/calendar",
      filename: "invite.ics",
      disposition: "attachment",
    });
    expect(attachments[1]).toEqual({
      content: toBase64("some notes"),
      type: "text/plain",
      filename: "notes.txt",
      disposition: "attachment",
    });
  });

  it("normalizes MIME parameters for ordinary attachments too", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(
      baseMessage({
        attachments: [
          { filename: "notes.txt", content: "some notes", contentType: "text/plain; charset=utf-8" },
        ],
      }),
    );

    const body = sentBody(fetchImpl);
    expect(body.attachments).toEqual([
      {
        content: toBase64("some notes"),
        type: "text/plain",
        filename: "notes.txt",
        disposition: "attachment",
      },
    ]);
  });

  it("rejects attachment content types containing CRLF before calling SendGrid", async () => {
    const fetchImpl = stubFetch({ status: 202 });

    await expect(
      makeSender(fetchImpl).send(
        baseMessage({
          attachments: [
            {
              filename: "notes.txt",
              content: "some notes",
              contentType: "text/plain\r\nX-Injected: true",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/cannot contain CR or LF/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("omits attachments entirely when there are none", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-1" } });
    await makeSender(fetchImpl).send(baseMessage());

    const body = sentBody(fetchImpl);
    expect(body.attachments).toBeUndefined();
  });
});

describe("createSendGridEmailSender — response handling", () => {
  it("returns the provider id from the x-message-id header on 202", async () => {
    const fetchImpl = stubFetch({ status: 202, headers: { "x-message-id": "sg-abc123" } });
    const result = await makeSender(fetchImpl).send(baseMessage());
    expect(result.id).toBe("sg-abc123");
  });

  it("falls back to an empty id when the header is missing", async () => {
    const fetchImpl = stubFetch({ status: 202 });
    const result = await makeSender(fetchImpl).send(baseMessage());
    expect(result.id).toBe("");
  });

  it("throws with the SendGrid error message and the status code on a 400", async () => {
    const fetchImpl = stubFetch({
      status: 400,
      body: JSON.stringify({
        errors: [{ message: "The from email does not contain a valid address." }],
      }),
    });
    await expect(makeSender(fetchImpl).send(baseMessage())).rejects.toThrow(
      /SendGrid send failed \(400\).*from email does not contain a valid address/,
    );
  });

  it("falls back to the raw body when the error response isn't JSON", async () => {
    const fetchImpl = stubFetch({ status: 502, body: "<html>Bad Gateway</html>" });
    await expect(makeSender(fetchImpl).send(baseMessage())).rejects.toThrow(
      /SendGrid send failed \(502\).*Bad Gateway/,
    );
  });
});

describe("toBase64", () => {
  it("survives unicode content", () => {
    const encoded = toBase64("café — café ☕ 日本語");
    expect(encoded).toBe(btoa(unescape(encodeURIComponent("café — café ☕ 日本語"))));
  });
});

// ---------------------------------------------------------------------------
// getEmailSender — what a production deployment with no API key does
// ---------------------------------------------------------------------------

describe("getEmailSender", () => {
  /** Sets NODE_ENV for one test and puts it back afterwards. */
  function withNodeEnv<T>(value: string | undefined, run: () => T): T {
    if (value === undefined) vi.stubEnv("NODE_ENV", undefined);
    else vi.stubEnv("NODE_ENV", value);
    try {
      return run();
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("uses SendGrid whenever a key is configured", () => {
    const sender = withNodeEnv("production", () =>
      getEmailSender({ SENDGRID_API_KEY: "sg-key", EMAIL_FROM_ADDRESS: "hello@greenroom.test" }),
    );
    expect(sender.from.email).toBe("hello@greenroom.test");
  });

  it("refuses to send in production when the key is missing", async () => {
    // Silently "succeeding" here is the failure this guards: magic links,
    // decisions and invitations would all be logged as sent and none of them
    // would arrive (decisions.md D-030).
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sender = withNodeEnv("production", () => getEmailSender({}));

    await expect(
      sender.send(baseMessage({ text: "Body", html: "<p>Body</p>" })),
    ).rejects.toThrow(MISSING_API_KEY_ERROR);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("keeps the dev transport outside production, which e2e depends on", async () => {
    // The Playwright suite reads magic links out of the dev transport's
    // output — this branch must not change.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = withNodeEnv("test", () => getEmailSender({}));

    const result = await sender.send(baseMessage({ text: "Body", html: "<p>Body</p>" }));

    expect(result.id).toMatch(/^dev-/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("keeps the dev transport when NODE_ENV isn't set at all", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = withNodeEnv(undefined, () => getEmailSender({}));

    await expect(
      sender.send(baseMessage({ text: "Body", html: "<p>Body</p>" })),
    ).resolves.toBeTruthy();
    log.mockRestore();
  });
});
