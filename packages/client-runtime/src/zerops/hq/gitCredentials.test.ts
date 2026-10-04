import { describe, expect, it } from "@effect/vitest";
import { makeHqApi } from "./client.ts";
const record = {
  id: "id-1",
  appId: "app",
  createdAt: "2026-10-04T10:00:00Z",
  expiresAt: "2026-10-04T22:00:00Z",
};
describe("personal Git credential client", () => {
  it("issues, lists metadata, and revokes through the person's session without exposing the password in a URL", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const api = makeHqApi({
      address: "https://hq.example",
      throughDoor: async (use) => use("door"),
      openSocket: () => {
        throw new Error("unused");
      },
      fetch: async (url, init) => {
        seen.push({ url, ...(init === undefined ? {} : { init }) });
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "own", expiresAt: "later" }), {
            status: 200,
          });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return new Response(
          JSON.stringify(
            init?.method === "POST"
              ? { ...record, token: "test-password" }
              : { credentials: [record] },
          ),
          { status: 200 },
        );
      },
    });
    expect(await api.issueGitCredential("app")).toEqual({ ...record, token: "test-password" });
    expect(await api.gitCredentials("app")).toEqual([record]);
    await api.revokeGitCredential("app", "id-1");
    expect(
      seen
        .slice(1)
        .map((call) => [
          new URL(call.url).pathname,
          call.init?.method ?? "GET",
          new Headers(call.init?.headers).get("authorization"),
        ]),
    ).toEqual([
      ["/api/apps/app/git-credentials", "POST", "Bearer own"],
      ["/api/apps/app/git-credentials", "GET", "Bearer own"],
      ["/api/apps/app/git-credentials/id-1", "DELETE", "Bearer own"],
    ]);
    expect(seen.every((call) => !call.url.includes("test-password"))).toBe(true);
  });
  it("never retries a lost issue attempt", async () => {
    let attempts = 0;
    const api = makeHqApi({
      address: "https://hq.example",
      throughDoor: async (use) => use("door"),
      openSocket: () => {
        throw new Error("unused");
      },
      fetch: async (url) => {
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "own", expiresAt: "later" }), {
            status: 200,
          });
        attempts++;
        throw new TypeError("offline");
      },
    });
    await expect(api.issueGitCredential("app")).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
