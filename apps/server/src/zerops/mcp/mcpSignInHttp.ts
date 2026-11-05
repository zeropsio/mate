import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { MCP_SIGN_IN_PATH, McpServers } from "./McpServers.ts";

/**
 * `GET /mcp/oauth/callback` (`/mate/mcp/oauth/callback` behind the
 * container's nginx): where an MCP server's provider sends the person's
 * browser after they signed in, with a one-time code. Public, as any OAuth
 * redirect is: it acts only on a landing whose `state` names a sign-in this
 * Mate started (`McpServers.landed`), once. The address carries the code, so
 * the page sends no referrer, is never cached, and never shows or logs it.
 */
export const mcpSignInRouteLayer = HttpRouter.add(
  "GET",
  MCP_SIGN_IN_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const mcp = yield* Effect.serviceOption(McpServers);
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(mcp) || Option.isNone(url)) {
      return signInPage(404, "Nothing to sign in to here", "This Mate has no MCP servers.");
    }
    return yield* mcp.value.landed(url.value).pipe(
      Effect.map((name) =>
        signInPage(
          200,
          `Signed in to ${name}`,
          `This Mate's agents can use ${name}'s tools now. You can close this tab and go back to Mate.`,
        ),
      ),
      Effect.catchTags({
        McpServersError: (error) =>
          Effect.succeed(
            signInPage(
              400,
              "The sign-in didn't finish",
              `${error.detail} Go back to Mate to try again.`,
            ),
          ),
      }),
    );
  }),
);

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

function signInPage(status: number, title: string, body: string) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 26rem; padding: 0 1rem; }
h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.25rem; }
p { margin: 0; opacity: 0.75; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body>
</html>`;
  return HttpServerResponse.text(html, {
    status,
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-frame-options": "DENY",
    },
  });
}
