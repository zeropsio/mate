// @effect-diagnostics globalFetch:off - Drives the real loopback server the
// way a browser would, end to end; a mocked HttpClient would prove nothing
// about the actual socket this server binds.
import { assert, describe, it } from "@effect/vitest";

import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";

import { startZeropsCallbackServer } from "./zeropsCallbackServer.ts";

async function withServer(
  run: (
    server: Awaited<ReturnType<typeof startZeropsCallbackServer>>,
    fragments: string[],
  ) => Promise<void>,
) {
  const fragments: string[] = [];
  const server = await startZeropsCallbackServer((fragment) => fragments.push(fragment));
  try {
    await run(server, fragments);
  } finally {
    server.close();
  }
}

function callbackUrl(server: { readonly port: number }): string {
  return `http://127.0.0.1:${server.port}${ZEROPS_HANDOVER_CALLBACK_PATH}`;
}

describe("startZeropsCallbackServer", () => {
  it("binds the loopback interface only", () =>
    withServer(async (server) => {
      assert.equal(server.address, "127.0.0.1");
      assert.isAbove(server.port, 0);
    }));

  it("serves a page at the callback path that a browser can GET", () =>
    withServer(async (server) => {
      const response = await fetch(callbackUrl(server));
      assert.equal(response.status, 200);
      assert.include(response.headers.get("content-type") ?? "", "text/html");
      const body = await response.text();
      assert.include(body, "Zerops Mate");
    }));

  it("404s any other path", () =>
    withServer(async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.port}/somewhere-else`);
      assert.equal(response.status, 404);
    }));

  // The fragment never reaches a server on its own — it's carried in
  // location.hash, which a browser never sends over the wire — so the GET
  // page's own script is what POSTs it back here, the same way a browser
  // would drive this exchange for real.
  it("forwards a fragment posted to the callback path, the way the served page would", () =>
    withServer(async (server, fragments) => {
      const response = await fetch(callbackUrl(server), {
        method: "POST",
        body: "#token=rt-1&state=nonce-1",
      });
      assert.equal(response.status, 204);
      assert.deepEqual(fragments, ["#token=rt-1&state=nonce-1"]);
    }));

  it("is single-use: only the first posted fragment is forwarded", () =>
    withServer(async (server, fragments) => {
      await fetch(callbackUrl(server), { method: "POST", body: "#token=rt-1&state=nonce-1" });
      await fetch(callbackUrl(server), { method: "POST", body: "#token=rt-2&state=nonce-1" });

      assert.deepEqual(fragments, ["#token=rt-1&state=nonce-1"]);
    }));

  it("closes cleanly and stops answering requests", () =>
    withServer(async (server) => {
      server.close();
      let threw = false;
      try {
        await fetch(callbackUrl(server));
      } catch {
        threw = true;
      }
      assert.isTrue(threw);
    }));
});
