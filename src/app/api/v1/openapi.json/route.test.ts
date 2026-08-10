import { describe, expect, it } from "vitest";
import { GET as getDocs } from "@/app/api/docs/route";
import { GET as getOpenApi } from "./route";

describe("API reference", () => {
  it("publishes an OpenAPI 3.1 document covering REST v1", async () => {
    const response = await getOpenApi();
    const document = (await response.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/events/{eventId}/sessions"].get).toBeTruthy();
    expect(document.paths["/events/{eventId}/sessions"].post).toBeTruthy();
    expect(document.paths["/events/{eventId}/submissions/{submissionId}/decision"].post).toBeTruthy();
    expect(document.components.securitySchemes.ApiKey).toBeTruthy();
    expect(document.components.securitySchemes.OAuth2).toBeTruthy();
  });

  it("documents concrete mutation bodies, DTO envelopes, and actual success statuses", async () => {
    const response = await getOpenApi();
    const document = (await response.json()) as {
      paths: Record<string, Record<string, {
        requestBody?: { content: { "application/json": { schema: { $ref?: string } } } };
        responses: Record<string, { content?: { "application/json": { schema: unknown } } }>;
      }>>;
      components: { schemas: Record<string, unknown> };
    };
    const sessions = document.paths["/events/{eventId}/sessions"].post;
    const placement = document.paths["/events/{eventId}/sessions/{sessionId}/placement"];
    const decision = document.paths["/events/{eventId}/submissions/{submissionId}/decision"].post;

    expect(sessions.requestBody?.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/CreateSessionInput",
    );
    expect(sessions.responses["201"].content?.["application/json"].schema).toBeTruthy();
    expect(placement.delete.responses["200"]).toBeTruthy();
    expect(placement.delete.responses["204"]).toBeUndefined();
    expect(decision.responses["200"]).toBeTruthy();
    expect(decision.responses["201"]).toBeUndefined();
    expect(document.components.schemas.SessionDetail).toBeTruthy();
    expect(document.components.schemas.DecisionResult).toBeTruthy();
  });

  it("serves an interactive Scalar page bound to the OpenAPI URL", async () => {
    const response = await getDocs();
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("@scalar/api-reference");
    expect(html).toContain("/api/v1/openapi.json");
  });
});
