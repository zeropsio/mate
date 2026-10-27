// @effect-diagnostics nodeBuiltinImport:off - A short-lived, single-purpose
// loopback listener; plain node:http keeps it self-contained rather than
// pulling in the Effect HTTP server for one handler.
/**
 * The loopback half of the native Zerops sign-in: a tiny HTTP server that
 * exists only long enough to catch the platform's redirect back from the
 * system browser.
 *
 * The token rides in the redirect's URL fragment, and a fragment never
 * reaches a server — the browser keeps it client-side. So the page this
 * serves at the callback path is not decoration: its own script reads
 * `location.hash` and POSTs it back here, which is the only way the token
 * gets from the browser tab into this process.
 */
import * as NodeHttp from "node:http";

import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";

const CALLBACK_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Zerops Mate</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #ffffff;
    color: #1f2937;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #f8fafc; }
  }
  p { font-size: 14px; }
</style>
</head>
<body>
<p id="zerops-mate-message">Finishing sign-in&hellip;</p>
<script>
fetch(location.pathname, { method: "POST", body: location.hash }).catch(function () {}).finally(function () {
  document.getElementById("zerops-mate-message").textContent =
    "You can close this tab and return to Zerops Mate.";
});
</script>
</body>
</html>
`;

export interface ZeropsCallbackServer {
  readonly port: number;
  readonly address: string;
  readonly close: () => void;
}

function callbackPathname(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
}

/**
 * Shared across both loopback listeners (IPv4 and, when available, IPv6):
 * whichever socket a POST lands on first wins, and every later delivery —
 * on either socket — is a no-op.
 */
function makeRequestListener(
  onFragment: (fragment: string) => void,
): (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => void {
  let delivered = false;

  return (request, response) => {
    if (callbackPathname(request.url) !== ZEROPS_HANDOVER_CALLBACK_PATH) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(CALLBACK_PAGE_HTML);
      return;
    }

    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        response.writeHead(204);
        response.end();
        if (delivered) return;
        delivered = true;
        onFragment(Buffer.concat(chunks).toString("utf8"));
      });
      return;
    }

    response.writeHead(405);
    response.end();
  };
}

/**
 * Starts the callback listener and resolves once it can answer requests.
 * Binds `127.0.0.1`; the platform sends the browser to the name `localhost`,
 * which some stacks resolve to `::1` instead, so a best-effort second
 * listener tries that too — its failure to bind (no IPv6 loopback, disabled
 * stack) is not fatal, since `127.0.0.1` already answers `localhost` almost
 * everywhere.
 */
export function startZeropsCallbackServer(
  onFragment: (fragment: string) => void,
): Promise<ZeropsCallbackServer> {
  return new Promise((resolve, reject) => {
    const listener = makeRequestListener(onFragment);
    const servers: NodeHttp.Server[] = [];

    const primary = NodeHttp.createServer(listener);
    const onPrimaryError = (cause: Error) => {
      reject(cause);
    };
    primary.once("error", onPrimaryError);
    primary.listen(0, "127.0.0.1", () => {
      primary.removeListener("error", onPrimaryError);
      servers.push(primary);
      const address = primary.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const boundAddress =
        typeof address === "object" && address !== null ? address.address : "127.0.0.1";

      const secondary = NodeHttp.createServer(listener);
      secondary.once("error", () => {
        secondary.close();
      });
      secondary.listen(port, "::1", () => {
        servers.push(secondary);
      });

      resolve({
        port,
        address: boundAddress,
        close: () => {
          for (const server of servers) {
            server.close();
          }
        },
      });
    });
  });
}
