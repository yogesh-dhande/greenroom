import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  addRoom,
  addTrack,
  createIsolatedForm,
  expect,
  publishForm,
  test,
} from "./fixtures";
import { signIn } from "./helpers";

interface ApiEventListItem {
  id: string;
  name: string;
}

interface ApiEventsResponse {
  data: ApiEventListItem[];
}

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

interface ApiDataResponse<T> {
  data: T;
}

interface ApiRoom {
  id: string;
  name: string;
}

interface ApiSpeaker {
  id: string;
  name: string | null;
  email: string;
  confirmationStatus: "unconfirmed" | "confirmed" | "declined";
  confirmationSource: "automatic" | "override";
  company?: string | null;
  notes?: string | null;
}

interface ApiSession {
  id: string;
  title: string;
  description: string | null;
  schedulingStatus: "scheduled" | "unscheduled";
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  room: { id: string; name: string } | null;
  speakers: Array<{ id: string; name: string | null; email: string }>;
}

test("an admin creates, uses, and revokes an event-scoped API key", async ({
  page,
  baseURL,
  fixtureId,
  isolatedEvent,
}) => {
  test.slow();
  const label = `E2E integration ${fixtureId}`;
  const roomName = `API room ${fixtureId}`;
  const trackName = `API track ${fixtureId}`;
  await addRoom(page, isolatedEvent.slug, roomName);
  await addTrack(page, isolatedEvent.slug, trackName);

  // Give the decision endpoint a submission owned only by this test. Public
  // intake stays public; the credential is created only after it exists.
  const form = await createIsolatedForm(page, isolatedEvent.slug, fixtureId, {
    name: `API CFP ${fixtureId}`,
  });
  await publishForm(page, form);
  await page.context().clearCookies();
  await page.goto(form.publicPath);
  const submissionTitle = `API proposal ${fixtureId}`;
  await page.getByLabel("Talk title").fill(submissionTitle);
  await page
    .getByLabel("Abstract")
    .fill("A proposal created to exercise the external decision workflow.");
  await page.getByLabel(trackName).check();
  await page.getByLabel("Your name").fill(`Proposal Speaker ${fixtureId}`);
  await page.getByLabel("Your email").fill(`${fixtureId}-proposal@example.com`);
  await page
    .getByLabel("Speaker biography")
    .fill(
      "Builds event integrations and tests them through public interfaces.",
    );
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/);
  const submissionId = new URL(page.url()).pathname.split("/").pop();
  expect(submissionId).toEqual(expect.any(String));
  if (!submissionId) throw new Error("The public submission URL had no ID");
  await signIn(page, "admin@greenroom.dev");

  // The isolated-event fixture leaves this browser signed in as the seeded
  // admin. Create a write key limited to this test's event.
  await page.goto("/admin/api");
  await expect(page.getByRole("heading", { name: "API & MCP" })).toBeVisible();
  await page.getByRole("button", { name: "Create API key" }).click();

  const createDialog = page.getByRole("dialog", { name: "Create API key" });
  await createDialog.getByLabel("Label").fill(label);
  await createDialog.getByRole("radio", { name: "Read & write" }).check();
  await createDialog.getByRole("radio", { name: "Selected events" }).check();
  await createDialog.getByText(isolatedEvent.name, { exact: true }).click();
  await expect(createDialog.getByLabel("Expires after")).toHaveValue("90");
  await createDialog.getByRole("button", { name: "Create key" }).click();

  // The complete gr_ secret exists only in this success state. Capture it as
  // a test-local value before closing, just as a real integration would.
  const saveDialog = page.getByRole("dialog", { name: "Save your API key" });
  await expect(saveDialog).toContainText(
    "This is the only time Greenroom will show the full key",
  );
  const secret = await saveDialog.getByLabel("API key").inputValue();
  expect(secret).toMatch(/^gr_[A-Za-z0-9_-]+$/);
  await saveDialog.getByRole("button", { name: "I've saved the key" }).click();

  const credentialRow = page.getByRole("row").filter({ hasText: label });
  await expect(credentialRow).toContainText("Read");
  await expect(credentialRow).toContainText("Write");
  await expect(credentialRow).toContainText(isolatedEvent.name);
  await expect(credentialRow).toContainText("Never");
  await expect(page.locator("#new-api-key")).toHaveCount(0);
  await expect(credentialRow).not.toContainText(secret);

  // Exercise the credential through the public HTTP boundary, not through a
  // repository helper. The selected-event scope also shapes event listing.
  const authenticated = await page.request.get("/api/v1/events", {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(authenticated.status()).toBe(200);
  expect(authenticated.headers()["content-type"]).toContain("application/json");
  const events = (await authenticated.json()) as ApiEventsResponse;
  expect(events.data).toEqual([
    expect.objectContaining({ name: isolatedEvent.name }),
  ]);
  expect(events.data[0]?.id).toEqual(expect.any(String));
  const eventId = events.data[0]!.id;
  const eventApiPath = `/api/v1/events/${eventId}`;
  const apiHeaders = { Authorization: `Bearer ${secret}` };

  const roomsResponse = await page.request.get(`${eventApiPath}/rooms`, {
    headers: apiHeaders,
  });
  expect(roomsResponse.status()).toBe(200);
  const rooms = (await roomsResponse.json()) as { data: ApiRoom[] };
  const room = rooms.data.find((candidate) => candidate.name === roomName);
  expect(room?.id).toEqual(expect.any(String));
  if (!room) throw new Error("The room created for the API E2E was not listed");

  const speakerName = `REST Speaker ${fixtureId}`;
  const speakerResponse = await page.request.post(`${eventApiPath}/speakers`, {
    headers: apiHeaders,
    data: {
      name: speakerName,
      email: `${fixtureId}-rest@example.com`,
      title: "API producer",
    },
  });
  expect(speakerResponse.status()).toBe(201);
  const { data: speaker } =
    (await speakerResponse.json()) as ApiDataResponse<ApiSpeaker>;
  expect(speaker).toEqual(
    expect.objectContaining({
      name: speakerName,
      email: `${fixtureId}-rest@example.com`,
      confirmationStatus: "unconfirmed",
    }),
  );

  const speakerPatchResponse = await page.request.patch(
    `${eventApiPath}/speakers/${speaker.id}`,
    {
      headers: apiHeaders,
      data: {
        company: "Greenroom E2E",
        notes: `Created through REST ${fixtureId}`,
      },
    },
  );
  expect(speakerPatchResponse.status()).toBe(200);
  const patchedSpeaker =
    (await speakerPatchResponse.json()) as ApiDataResponse<ApiSpeaker>;
  expect(patchedSpeaker.data).toEqual(
    expect.objectContaining({
      company: "Greenroom E2E",
      notes: `Created through REST ${fixtureId}`,
    }),
  );

  const confirmationResponse = await page.request.put(
    `${eventApiPath}/speakers/${speaker.id}/confirmation`,
    {
      headers: apiHeaders,
      data: { confirmation: "confirmed" },
    },
  );
  expect(confirmationResponse.status()).toBe(200);
  const confirmed =
    (await confirmationResponse.json()) as ApiDataResponse<ApiSpeaker>;
  expect(confirmed.data).toEqual(
    expect.objectContaining({
      confirmationStatus: "confirmed",
      confirmationSource: "override",
    }),
  );

  const originalTitle = `REST Session ${fixtureId}`;
  const sessionResponse = await page.request.post(`${eventApiPath}/sessions`, {
    headers: apiHeaders,
    data: {
      title: originalTitle,
      description: "Created through the Core API",
      speakerIds: [speaker.id],
    },
  });
  expect(sessionResponse.status()).toBe(201);
  const { data: session } =
    (await sessionResponse.json()) as ApiDataResponse<ApiSession>;
  expect(session).toEqual(
    expect.objectContaining({
      title: originalTitle,
      schedulingStatus: "unscheduled",
      speakers: [expect.objectContaining({ id: speaker.id })],
    }),
  );

  const updatedTitle = `${originalTitle} updated`;
  const updateResponse = await page.request.patch(
    `${eventApiPath}/sessions/${session.id}`,
    {
      headers: apiHeaders,
      data: {
        title: updatedTitle,
        description: "Edited through the same shared workflow",
      },
    },
  );
  expect(updateResponse.status()).toBe(200);
  const updated = (await updateResponse.json()) as ApiDataResponse<ApiSession>;
  expect(updated.data).toEqual(
    expect.objectContaining({
      title: updatedTitle,
      description: "Edited through the same shared workflow",
    }),
  );

  const decisionResponse = await page.request.post(
    `${eventApiPath}/submissions/${submissionId}/decision`,
    {
      headers: apiHeaders,
      data: {
        decision: "maybe",
        note: "Waitlisted through the Core API",
        notify: false,
      },
    },
  );
  expect(decisionResponse.status()).toBe(200);
  const decision = (await decisionResponse.json()) as ApiDataResponse<{
    submission: { id: string; title: string; status: string };
    notified: boolean;
  }>;
  expect(decision.data).toEqual(
    expect.objectContaining({
      submission: expect.objectContaining({
        id: submissionId,
        title: submissionTitle,
        status: "maybe",
      }),
      notified: false,
    }),
  );

  // The official v2 client performs server/discover and the negotiated
  // initialization handshake. Its native HTTP transport intentionally sends
  // no Origin header; the same bearer key authenticates MCP and REST.
  if (!baseURL)
    throw new Error("Playwright baseURL is required for the MCP client");
  const client = new Client(
    { name: "greenroom-e2e", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("/mcp", baseURL),
    {
      authProvider: { token: async () => secret },
    },
  );
  try {
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_events", "get_event", "add_speaker"]),
    );
    expect(
      tools.tools.find((tool) => tool.name === "list_events")?.annotations,
    ).toEqual(
      expect.objectContaining({ readOnlyHint: true, destructiveHint: false }),
    );

    const resources = await client.listResources();
    expect(resources.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uri: "greenroom://events" }),
      ]),
    );
    const templates = await client.listResourceTemplates();
    expect(
      templates.resourceTemplates.map((template) => template.uriTemplate),
    ).toEqual(
      expect.arrayContaining([
        "greenroom://events/{eventId}",
        "greenroom://events/{eventId}/sessions/{sessionId}",
      ]),
    );

    const eventResource = await client.readResource({
      uri: "greenroom://events",
    });
    const eventResourceContent = eventResource.contents[0];
    expect(eventResourceContent).toEqual(
      expect.objectContaining({
        uri: "greenroom://events",
        mimeType: "application/json",
      }),
    );
    if (!eventResourceContent || !("text" in eventResourceContent)) {
      throw new Error("The events MCP resource did not return JSON text");
    }
    expect(JSON.parse(eventResourceContent.text)).toEqual(
      expect.objectContaining({
        data: [expect.objectContaining({ name: isolatedEvent.name })],
      }),
    );

    const mcpEvents = await client.callTool({
      name: "list_events",
      arguments: {},
    });
    expect(mcpEvents.isError).not.toBe(true);
    expect(mcpEvents.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
    expect(mcpEvents.structuredContent).toEqual(
      expect.objectContaining({
        data: [expect.objectContaining({ name: isolatedEvent.name })],
      }),
    );

    const mcpSpeakerName = `MCP Speaker ${fixtureId}`;
    const added = await client.callTool({
      name: "add_speaker",
      arguments: {
        eventId,
        name: mcpSpeakerName,
        email: `${fixtureId}-mcp@example.com`,
      },
    });
    expect(added.isError).not.toBe(true);
    expect(added.structuredContent).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ name: mcpSpeakerName }),
      }),
    );

    const mcpSpeaker = added.structuredContent as
      { data?: { id?: unknown } } | undefined;
    expect(mcpSpeaker?.data?.id).toEqual(expect.any(String));
    if (typeof mcpSpeaker?.data?.id !== "string") {
      throw new Error(
        "The MCP add_speaker result did not include a speaker ID",
      );
    }

    const assignmentResponse = await page.request.put(
      `${eventApiPath}/sessions/${session.id}/speakers`,
      {
        headers: apiHeaders,
        data: { speakerIds: [speaker.id, mcpSpeaker.data.id] },
      },
    );
    expect(assignmentResponse.status()).toBe(200);
    const assigned =
      (await assignmentResponse.json()) as ApiDataResponse<ApiSession>;
    expect(assigned.data.speakers.map((person) => person.id)).toEqual(
      expect.arrayContaining([speaker.id, mcpSpeaker.data.id]),
    );
  } finally {
    await client.close().catch(() => undefined);
  }

  const placementResponse = await page.request.put(
    `${eventApiPath}/sessions/${session.id}/placement`,
    {
      headers: apiHeaders,
      data: {
        day: isolatedEvent.startDate,
        startTime: "09:00",
        endTime: "09:45",
        roomId: room.id,
      },
    },
  );
  expect(placementResponse.status()).toBe(200);
  const placed = (await placementResponse.json()) as ApiDataResponse<{
    session: ApiSession;
    conflicts: unknown[];
  }>;
  expect(placed.data).toEqual(
    expect.objectContaining({
      session: expect.objectContaining({
        schedulingStatus: "scheduled",
        day: isolatedEvent.startDate,
        startTime: "09:00",
        endTime: "09:45",
        room: expect.objectContaining({ id: room.id, name: roomName }),
      }),
      conflicts: [],
    }),
  );

  const unscheduleResponse = await page.request.delete(
    `${eventApiPath}/sessions/${session.id}/placement`,
    { headers: apiHeaders },
  );
  expect(unscheduleResponse.status()).toBe(200);
  const unscheduled =
    (await unscheduleResponse.json()) as ApiDataResponse<ApiSession>;
  expect(unscheduled.data).toEqual(
    expect.objectContaining({
      schedulingStatus: "unscheduled",
      day: null,
      startTime: "09:00",
      endTime: "09:45",
      room: null,
    }),
  );

  // Revocation is destructive, so the UI requires an explicit confirmation.
  await credentialRow.getByRole("button", { name: `Revoke ${label}` }).click();
  const revokeDialog = page.getByRole("alertdialog", {
    name: `Revoke ${label}?`,
  });
  await expect(revokeDialog).toContainText("will stop working immediately");
  await revokeDialog.getByRole("button", { name: "Revoke key" }).click();
  await expect(page.getByText(`${label} was revoked`)).toBeVisible();
  await expect(credentialRow).toHaveCount(0);

  const revoked = await page.request.get("/api/v1/events", {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(revoked.status()).toBe(401);
  expect(revoked.headers()["x-request-id"]).toEqual(expect.any(String));
  const denied = (await revoked.json()) as ApiErrorResponse;
  expect(denied.error).toEqual(
    expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
      requestId: revoked.headers()["x-request-id"],
    }),
  );
});

test("the REST API rejects a request without an external credential", async ({
  request,
}) => {
  const response = await request.get("/api/v1/events");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-request-id"]).toEqual(expect.any(String));

  const body = (await response.json()) as ApiErrorResponse;
  expect(body.error).toEqual(
    expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
      requestId: response.headers()["x-request-id"],
    }),
  );
});

test("the MCP endpoint rejects a browser request from an untrusted origin", async ({
  request,
}) => {
  const response = await request.post("/mcp", {
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "server/discover",
      Origin: "https://attacker.example",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
  });

  expect(response.status()).toBe(403);
});
