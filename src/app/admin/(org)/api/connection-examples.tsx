import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "./copy-button";

function Example({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <CopyButton value={value} />
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed text-foreground">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export function ConnectionExamples({ baseUrl }: { baseUrl: string }) {
  const rest = [
    `curl ${baseUrl}/api/v1/events \\`,
    "  -H 'Authorization: Bearer gr_your_key_here'",
  ].join("\n");
  const mcp = JSON.stringify(
    {
      mcpServers: {
        greenroom: {
          url: `${baseUrl}/mcp`,
          headers: { Authorization: "Bearer gr_your_key_here" },
        },
      },
    },
    null,
    2,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect</CardTitle>
        <CardDescription>
          Use the same key with the REST API or a remote MCP client. Replace the placeholder with
          the secret shown when you create a key.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <Example title="REST API" value={rest} />
        <Example title="Remote MCP server" value={mcp} />
      </CardContent>
    </Card>
  );
}
