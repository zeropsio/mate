import { expect, it } from "@effect/vitest";

import { loopbackRedirect } from "./mcpLive.ts";

const signIn = (redirect: string) =>
  `https://auth.example.com/authorize?client_id=mate&redirect_uri=${encodeURIComponent(redirect)}`;

// witness: apps/server/src/spi/mcpControl.ts | redirect.protocol === "http:" && LOOPBACK_HOSTS.has(redirect.hostname) → redirect.protocol === "http:" || LOOPBACK_HOSTS.has(redirect.hostname)
it("SP+2: A remote MCP server's sign-in is answered by a listener in the container only when its redirect is a plain-http loopback address; any other goes back through the Mate's page", () => {
  const redirects = [
    "http://127.0.0.1:40123/callback",
    "http://localhost:40123/callback",
    "http://[::1]:40123/callback",
    "https://127.0.0.1:40123/callback",
    "http://mate.example.com/oauth/callback",
    "https://mate.example.com/oauth/callback",
  ];
  expect(redirects.map((redirect) => loopbackRedirect(signIn(redirect))?.href ?? null)).toEqual([
    "http://127.0.0.1:40123/callback",
    "http://localhost:40123/callback",
    "http://[::1]:40123/callback",
    null,
    null,
    null,
  ]);
  // A sign-in that names no redirect has no listener here either.
  expect(loopbackRedirect("https://auth.example.com/authorize?client_id=mate")).toBeUndefined();
});
