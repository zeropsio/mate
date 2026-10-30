import { describe, expect, it } from "vite-plus/test";
import { makeHqApi } from "./client.ts";

describe("ZCP authorization client", () => {
  it.each([undefined, "a".repeat(64)])(
    "records ZCP authorization through the person's HQ session with key hash %s",
    async (keyHash) => {
      const seen: Array<{
        path: string;
        method: string;
        authorization: string | null;
        body: unknown;
      }> = [];
      const api = makeHqApi({
        address: "https://hq.example",
        orgId: "org",
        accessToken: async () => "person-access",
        openSocket: () => {
          throw new Error("unused");
        },
        fetch: async (url, init) => {
          if (url.endsWith("/api/door"))
            return new Response(JSON.stringify({ session: "person-session", expiresAt: "later" }));
          seen.push({
            path: new URL(url).pathname,
            method: init?.method ?? "GET",
            authorization: new Headers(init?.headers).get("authorization"),
            body: JSON.parse(String(init?.body ?? "{}")),
          });
          return new Response(null, { status: 204 });
        },
      });
      expect(api.establishZcpAuthorization).toBeTypeOf("function");
      const context = {
        ...(keyHash === undefined ? {} : { keyHash }),
        userId: "untrusted-actor",
        credential: "untrusted-raw-key",
      };
      await api.establishZcpAuthorization?.("project/one", context);
      expect(seen).toEqual([
        {
          path: "/api/mates/project%2Fone/zcp-authorization",
          method: "POST",
          authorization: "Bearer person-session",
          body: keyHash === undefined ? {} : { keyHash },
        },
      ]);
    },
  );

  it("never repeats a ZCP authorization establishment whose answer was lost", async () => {
    let attempts = 0;
    const api = makeHqApi({
      address: "https://hq.example",
      orgId: "org",
      accessToken: async () => "person-access",
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
      api.establishZcpAuthorization?.("mate", { keyHash: "b".repeat(64) }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it.each(["door", "renewal"] as const)(
    "sends no ZCP authorization after account closure during the delayed HQ %s",
    async (phase) => {
      let active = true;
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const protectedWrites: string[] = [];
      const api = makeHqApi({
        address: "https://hq.example",
        orgId: "org",
        accessToken: async () => "original-person-access",
        isCurrent: () => active,
        now: () => 0,
        ...(phase === "renewal"
          ? {
              kept: {
                read: () => ({ token: "original-person-session", expiresAtMs: 1_000 }),
                keep: () => {},
                forget: () => {},
              },
            }
          : {}),
        openSocket: () => {
          throw new Error("unused");
        },
        fetch: async (url, init) => {
          if (url.endsWith("/api/door")) {
            expect(JSON.parse(String(init?.body))).toEqual({
              accessToken: "original-person-access",
              orgId: "org",
            });
            started.resolve();
            await release.promise;
            return new Response(
              JSON.stringify({ session: "original-person-session", expiresAt: "later" }),
            );
          }
          protectedWrites.push(new URL(url).pathname);
          return new Response(null, { status: 204 });
        },
      });
      const establishing = api.establishZcpAuthorization?.("mate", { keyHash: "a".repeat(64) });
      await started.promise;
      active = false;
      release.resolve();
      await expect(establishing).rejects.toMatchObject({ code: "account_changed" });
      expect(protectedWrites).toEqual([]);
    },
  );
});
