/** Low-volume lifecycle evidence for the intermittent deployed Worker stall. */

const DIAGNOSTIC_HEADER_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;

function diagnosticHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  return value && DIAGNOSTIC_HEADER_PATTERN.test(value) ? value : null;
}

function isDiagnosticRequest(request: Request, pathname: string): boolean {
  return (
    diagnosticHeader(request, "x-greenroom-smoke") !== null ||
    pathname === "/" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/portal" ||
    pathname.startsWith("/portal/")
  );
}

export interface WorkerRequestDiagnostics {
  trace<T extends { status: number }>(request: Request, handle: () => Promise<T>): Promise<T>;
}

/**
 * One instance per isolate. Its identity and counters show whether failures
 * cluster in a long-lived isolate or overlap cold-start work. It never records
 * cookie values, query strings, request/response bodies, or error messages.
 */
export function createWorkerRequestDiagnostics(): WorkerRequestDiagnostics {
  const workerInstanceId = crypto.randomUUID();
  const workerStartedAt = Date.now();
  let requestSequence = 0;
  let activeRequests = 0;

  function log(fields: Record<string, unknown>): void {
    // A synchronous start record survives even when the handler promise never
    // settles and Cloudflare eventually cancels the invocation.
    console.log(JSON.stringify(fields));
  }

  return {
    async trace<T extends { status: number }>(request: Request, handle: () => Promise<T>) {
      const pathname = new URL(request.url).pathname;
      if (!isDiagnosticRequest(request, pathname)) return handle();

      const startedAt = Date.now();
      const activeAtStart = ++activeRequests;
      const common = {
        requestId: crypto.randomUUID(),
        workerInstanceId,
        requestSequence: ++requestSequence,
        method: request.method,
        pathname,
        smokeRun: diagnosticHeader(request, "x-greenroom-smoke"),
        smokeProbe: diagnosticHeader(request, "x-greenroom-smoke-probe"),
        cfRay: diagnosticHeader(request, "cf-ray"),
      };

      log({
        event: "greenroom.request.start",
        timestamp: new Date(startedAt).toISOString(),
        ...common,
        workerStartedAt: new Date(workerStartedAt).toISOString(),
        workerAgeMs: startedAt - workerStartedAt,
        activeRequests: activeAtStart,
        hasCookie: request.headers.has("cookie"),
        isRsc: request.headers.has("rsc"),
        isPrefetch:
          request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch",
      });

      try {
        const response = await handle();
        log({
          event: "greenroom.request.finish",
          timestamp: new Date().toISOString(),
          ...common,
          durationMs: Date.now() - startedAt,
          status: response.status,
          activeRequests,
        });
        return response;
      } catch (error) {
        log({
          event: "greenroom.request.error",
          timestamp: new Date().toISOString(),
          ...common,
          durationMs: Date.now() - startedAt,
          activeRequests,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        throw error;
      } finally {
        activeRequests -= 1;
      }
    },
  };
}
