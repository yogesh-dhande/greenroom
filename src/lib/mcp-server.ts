import {
  createMcpHandler,
  McpServer,
  preloadSchemas,
  ResourceNotFoundError,
  ResourceTemplate,
  type AuthInfo,
  type McpHttpHandler,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import {
  GREENROOM_MCP_RESOURCES,
  GREENROOM_MCP_RESOURCE_TEMPLATES,
  GREENROOM_MCP_TOOLS,
  mcpOutputSchemaForTool,
} from "@/lib/mcp-catalog";
import {
  mcpErrorEnvelope,
  shapeMcpResource,
  shapeMcpToolError,
  shapeMcpToolSuccess,
} from "@/lib/mcp-result";
import {
  hasMcpPermission,
  McpOperationError,
  type GreenroomMcpRuntime,
  type McpExecutionContext,
  type McpPrincipal,
} from "@/lib/mcp-runtime";
import {
  validateMcpRequest,
  withMcpAuthenticationChallenge,
  type McpRequestValidationOptions,
} from "@/lib/mcp-security";

const SERVER_INFO = { name: "greenroom", version: "1.0.0" } as const;
const PRINCIPAL_KEY = "com.greenroom/principal";
const REQUEST_ID_KEY = "com.greenroom/requestId";

// On workerd, eager schema construction moves this fixed cost to isolate
// startup instead of the first authenticated request.
preloadSchemas();

function executionContext(context: McpRequestContext): McpExecutionContext {
  const principal = context.authInfo?.extra?.[PRINCIPAL_KEY] as McpPrincipal | undefined;
  const requestId = context.authInfo?.extra?.[REQUEST_ID_KEY];
  if (!principal || typeof requestId !== "string") {
    throw new McpOperationError(500, "internal_error", "MCP request context is unavailable.");
  }
  return { principal, requestId };
}

function permissionError(permission: "read" | "write"): McpOperationError {
  return new McpOperationError(403, "insufficient_scope", `This tool requires ${permission} access.`, {
    requiredScope: `greenroom:${permission}`,
  });
}

function createGreenroomMcpServer(
  runtime: GreenroomMcpRuntime,
  requestContext: McpRequestContext,
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {} },
    instructions:
      "Greenroom manages event sessions, speakers, submissions, configuration, and agenda placement. All identifiers are event-scoped. Decision tools can send email; inspect the tool annotations and notify argument before calling them.",
    cacheHints: {
      "server/discover": { ttlMs: 300_000, cacheScope: "private" },
      "tools/list": { ttlMs: 300_000, cacheScope: "private" },
      "resources/list": { ttlMs: 60_000, cacheScope: "private" },
      "resources/templates/list": { ttlMs: 300_000, cacheScope: "private" },
      "resources/read": { ttlMs: 0, cacheScope: "private" },
    },
  });

  for (const tool of GREENROOM_MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: mcpOutputSchemaForTool(tool.name),
        annotations: tool.annotations,
      },
      async (args) => {
        let context: McpExecutionContext;
        try {
          context = executionContext(requestContext);
          if (!hasMcpPermission(context.principal, tool.permission)) {
            throw permissionError(tool.permission);
          }
          const result = await runtime.callTool(tool.name, args, context);
          return shapeMcpToolSuccess(result);
        } catch (error) {
          const requestId =
            typeof requestContext.authInfo?.extra?.[REQUEST_ID_KEY] === "string"
              ? (requestContext.authInfo.extra[REQUEST_ID_KEY] as string)
              : "unavailable";
          return shapeMcpToolError(error, requestId);
        }
      },
    );
  }

  const read = async (uri: URL) => {
    const context = executionContext(requestContext);
    if (!hasMcpPermission(context.principal, "read")) throw permissionError("read");
    try {
      return shapeMcpResource(await runtime.readResource(uri.href, context), uri.href);
    } catch (error) {
      if (error instanceof McpOperationError && error.status === 404) {
        throw new ResourceNotFoundError(uri.href, error.message);
      }
      // Preserve a safe structured envelope for application failures without
      // leaking thrown objects, credentials, or private request bodies.
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(mcpErrorEnvelope(error, context.requestId)),
          },
        ],
        ttlMs: 0,
        cacheScope: "private" as const,
      };
    }
  };

  for (const resource of GREENROOM_MCP_RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
        cacheHint: { ttlMs: 0, cacheScope: "private" },
      },
      read,
    );
  }

  for (const template of GREENROOM_MCP_RESOURCE_TEMPLATES) {
    server.registerResource(
      template.name,
      new ResourceTemplate(template.uriTemplate, { list: undefined }),
      {
        title: template.title,
        description: template.description,
        mimeType: "application/json",
        cacheHint: { ttlMs: 0, cacheScope: "private" },
      },
      async (uri) => read(uri),
    );
  }

  return server;
}

function sdkAuthInfo(principal: McpPrincipal, requestId: string): AuthInfo {
  return {
    // Authentication was already performed by the injected runtime. Keeping
    // the raw credential out of SDK context prevents accidental disclosure.
    token: "[redacted]",
    clientId: principal.credentialId,
    scopes: principal.scopes,
    extra: { [PRINCIPAL_KEY]: principal, [REQUEST_ID_KEY]: requestId },
  };
}

export interface GreenroomMcpHandlerOptions extends McpRequestValidationOptions {
  onerror?: (error: Error) => void;
}

export interface GreenroomMcpPostHandler {
  POST(request: Request): Promise<Response>;
  sdkHandler: McpHttpHandler;
}

/** Builds a stateless, dual-era Streamable HTTP handler around application services. */
export function createGreenroomMcpPostHandler(
  runtime: GreenroomMcpRuntime,
  options: GreenroomMcpHandlerOptions = {},
): GreenroomMcpPostHandler {
  const sdkHandler = createMcpHandler(
    (context) => createGreenroomMcpServer(runtime, context),
    {
      legacy: "stateless",
      responseMode: "json",
      onerror: options.onerror,
    },
  );

  return {
    sdkHandler,
    async POST(request) {
      const validationFailure = validateMcpRequest(request, options);
      if (validationFailure) return validationFailure;

      const requestId = crypto.randomUUID();
      const authentication = await runtime.authenticate(request);
      if (!authentication.ok) {
        const challenged = withMcpAuthenticationChallenge(request, authentication.response);
        challenged.headers.set("x-request-id", requestId);
        challenged.headers.set("cache-control", "private, no-store");
        return challenged;
      }

      const response = await sdkHandler.fetch(request, {
        authInfo: sdkAuthInfo(authentication.principal, requestId),
      });
      const headers = new Headers(response.headers);
      headers.set("x-request-id", requestId);
      headers.set("cache-control", "private, no-store");
      headers.append("vary", "Authorization, X-API-Key, Origin");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}
