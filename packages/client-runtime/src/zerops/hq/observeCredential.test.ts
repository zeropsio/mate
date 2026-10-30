import { describe, expect, it } from "vite-plus/test";
import { makeHqApi } from "./client.ts";

describe("personal observe credential client", () => {
  it("reads metadata without granting and changes authority only through explicit person requests", async () => {
    const seen: Array<[string, string, string | null]> = [];
    const revoked = { authorized: false, userId: null, expiresAt: null };
    const metadata = { authorized: true, userId: "person", expiresAt: "2026-11-28T10:00:00Z" };
    const api = makeHqApi({
      address: "https://hq.example",
      orgId: "org",
      accessToken: async () => "access",
      openSocket: () => {
        throw new Error("unused");
      },
      fetch: async (url, init) => {
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "person-session", expiresAt: "later" }));
        seen.push([
          new URL(url).pathname,
          init?.method ?? "GET",
          new Headers(init?.headers).get("authorization"),
        ]);
        if (url.endsWith("/zcp-authorization")) return new Response(null, { status: 204 });
        return new Response(
          JSON.stringify({
            ...(seen.length > 1 ? revoked : metadata),
            credential: "unexpected-secret",
          }),
        );
      },
    });
    expect(api.observeCredential).toBeTypeOf("function");
    expect(await api.observeCredential?.("project/one")).toEqual(metadata);
    expect(seen.map((call) => call[1])).toEqual(["GET"]);
    await api.establishZcpAuthorization?.("project/one", { keyHash: "a".repeat(64) });
    expect(await api.observeCredential?.("project/one")).toEqual(revoked);
    expect(seen).toEqual([
      ["/api/mates/project%2Fone/observe-credential", "GET", "Bearer person-session"],
      ["/api/mates/project%2Fone/zcp-authorization", "POST", "Bearer person-session"],
      ["/api/mates/project%2Fone/observe-credential", "GET", "Bearer person-session"],
    ]);
  });
  it("never repeats an authorization whose answer was lost", async () => {
    let attempts = 0;
    const api = makeHqApi({
      address: "https://hq.example",
      orgId: "org",
      accessToken: async () => "access",
      openSocket: () => {
        throw new Error("unused");
      },
      fetch: async (url) => {
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "person-session", expiresAt: "later" }));
        attempts++;
        throw new TypeError("offline");
      },
    });
    await expect(
      api.establishZcpAuthorization?.("mate", { keyHash: "a".repeat(64) }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
