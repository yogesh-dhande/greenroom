const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Greenroom API Reference</title>
  </head>
  <body>
    <script id="api-reference" data-url="/api/v1/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

export async function GET(): Promise<Response> {
  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": [
        "default-src 'none'",
        "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'unsafe-inline' https://cdn.jsdelivr.net",
        "img-src data: https:",
        "font-src data: https://cdn.jsdelivr.net",
        "connect-src 'self'",
      ].join("; "),
    },
  });
}
