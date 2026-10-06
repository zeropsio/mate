import { describe, expect, it } from "@effect/vitest";
import { makeHqApi } from "./client.ts";

describe("HQ source client", () => {
  it("escapes each id and query and never automatically repeats a failed source read", async () => {
    const calls: string[] = [];
    const api = makeHqApi({
      address: "https://hq.example",
      throughDoor: async (use) => use("door"),
      openSocket: () => {
        throw new Error("unused");
      },
      fetch: async (url) => {
        calls.push(url);
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "own", expiresAt: "later" }), {
            status: 200,
          });
        throw new TypeError("offline");
      },
    });
    await expect(
      api.repositorySource("a/b", "code", {
        rev: "refs/heads/topic/a",
        path: "src/a b.ts",
        kind: "file",
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(2);
    const request = new URL(calls[1]!);
    expect(request.pathname).toBe("/api/apps/a%2Fb/repos/code/source");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      rev: "refs/heads/topic/a",
      path: "src/a b.ts",
      kind: "file",
    });
  });
  it("renews an expired session through the door within the same attempt", async () => {
    const calls: string[] = [];
    let kept: string | null = "expired";
    const api = makeHqApi({
      address: "https://hq.example",
      throughDoor: async (use) => use("door"),
      openSocket: () => {
        throw new Error("unused");
      },
      kept: {
        read: () => kept,
        keep: ({ token }) => {
          kept = token;
        },
        forget: () => {
          kept = null;
        },
      },
      fetch: async (url, init) => {
        calls.push(url);
        if (url.endsWith("/api/door"))
          return new Response(JSON.stringify({ session: "fresh", expiresAt: "later" }), {
            status: 200,
          });
        if (new Headers(init?.headers).get("authorization") === "Bearer expired")
          return new Response(JSON.stringify({ code: "session_required" }), { status: 401 });
        return new Response(
          JSON.stringify({
            kind: "tree",
            revision: null,
            branches: [],
            branchesTruncated: false,
            path: "",
            entries: [],
            truncated: false,
          }),
          { status: 200 },
        );
      },
    });
    const query = { path: "", kind: "tree" as const };
    await expect(api.repositorySource("app", "code", query)).resolves.toMatchObject({
      kind: "tree",
    });
    expect(calls).toHaveLength(3);
    expect(kept).toBe("fresh");
  });
});
