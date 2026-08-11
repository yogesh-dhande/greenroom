import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerRequestDiagnostics } from "@/lib/worker-diagnostics";

type LogSpy = { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } };

function records(log: LogSpy): Array<Record<string, unknown>> {
  return log.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe("Worker request diagnostics", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("correlates start and finish without logging cookies or query values", async () => {
    const diagnostics = createWorkerRequestDiagnostics();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await diagnostics.trace(
      new Request("https://greenroom.test/admin/example?token=private", {
        headers: {
          cookie: "session=private",
          "cf-ray": "abc123-SJC",
          rsc: "1",
          "x-greenroom-smoke": "smoke-run-1",
          "x-greenroom-smoke-probe": "r1:authed:organizer:/admin/example",
        },
      }),
      async () => new Response("ok", { status: 200 }),
    );

    expect(response.status).toBe(200);
    const [start, finish] = records(log);
    expect(start).toMatchObject({
      event: "greenroom.request.start",
      pathname: "/admin/example",
      smokeRun: "smoke-run-1",
      smokeProbe: "r1:authed:organizer:/admin/example",
      cfRay: "abc123-SJC",
      hasCookie: true,
      isRsc: true,
    });
    expect(JSON.stringify(start)).not.toContain("private");
    expect(finish).toMatchObject({
      event: "greenroom.request.finish",
      requestId: start.requestId,
      workerInstanceId: start.workerInstanceId,
      requestSequence: start.requestSequence,
      status: 200,
    });
  });

  it("does not generate random values while the Worker module initializes", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000000");
    createWorkerRequestDiagnostics();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("records overlapping requests on the same isolate", async () => {
    const diagnostics = createWorkerRequestDiagnostics();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let releaseFirst!: (response: Response) => void;
    const first = diagnostics.trace(
      new Request("https://greenroom.test/admin"),
      () => new Promise<Response>((resolve) => { releaseFirst = resolve; }),
    );
    await diagnostics.trace(
      new Request("https://greenroom.test/portal"),
      async () => new Response("second"),
    );
    releaseFirst(new Response("first"));
    await first;

    const starts = records(log).filter((record) => record.event === "greenroom.request.start");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ activeRequests: 1 });
    expect(starts[1]).toMatchObject({
      activeRequests: 2,
      workerInstanceId: starts[0].workerInstanceId,
    });
  });

  it("traces a public smoke control but leaves ordinary public traffic unlogged", async () => {
    const diagnostics = createWorkerRequestDiagnostics();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const handle = async () => new Response("ok");

    await diagnostics.trace(new Request("https://greenroom.test/p/example/schedule"), handle);
    expect(log).not.toHaveBeenCalled();
    await diagnostics.trace(
      new Request("https://greenroom.test/p/example/schedule", {
        headers: { "x-greenroom-smoke": "smoke-run-1" },
      }),
      handle,
    );
    expect(records(log).map((record) => record.event)).toEqual([
      "greenroom.request.start",
      "greenroom.request.finish",
    ]);
  });
});
