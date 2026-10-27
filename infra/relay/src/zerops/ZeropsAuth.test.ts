import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ZeropsAuth from "./ZeropsAuth.ts";

function stub(route: (url: string) => Response) {
  const seen: Array<{ readonly url: string; readonly authorization: string | undefined }> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      seen.push({ url: request.url, authorization: request.headers.authorization });
      return Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url)));
    }),
  );
  return { layer, seen } as const;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ZeropsAuth.resolveZeropsApiBaseUrl", () => {
  it("defaults to production when the host is empty", () => {
    expect(ZeropsAuth.resolveZeropsApiBaseUrl(undefined)).toBe(
      "https://api.app-prg1.zerops.io/api/rest/public",
    );
    expect(ZeropsAuth.resolveZeropsApiBaseUrl("")).toBe(
      "https://api.app-prg1.zerops.io/api/rest/public",
    );
  });

  it("adds https:// to a bare host", () => {
    expect(ZeropsAuth.resolveZeropsApiBaseUrl("api.devel.zerops.io")).toBe(
      "https://api.devel.zerops.io/api/rest/public",
    );
  });

  it("keeps a host that already carries a scheme", () => {
    expect(ZeropsAuth.resolveZeropsApiBaseUrl("http://localhost:8787/")).toBe(
      "http://localhost:8787/api/rest/public",
    );
  });
});

describe("ZeropsAuth.verifyBearerToken", () => {
  it.effect("resolves the user id for a valid token, presenting it as a bearer header", () => {
    const { layer, seen } = stub((url) =>
      url.endsWith("/user/info") ? json({ id: "user_1" }) : json({ message: "unexpected" }, 500),
    );
    return Effect.gen(function* () {
      const principal = yield* ZeropsAuth.verifyBearerToken({
        apiBaseUrl: "https://api.example.test/api/rest/public",
        token: "a-token",
      });
      expect(principal).toEqual({ userId: "user_1" });
      expect(seen).toEqual([
        {
          url: "https://api.example.test/api/rest/public/user/info",
          authorization: "Bearer a-token",
        },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails with ZeropsInvalidTokenError on a 401", () => {
    const { layer } = stub(() => new Response(null, { status: 401 }));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsAuth.verifyBearerToken({ apiBaseUrl: "https://api.example.test", token: "bad" }),
      );
      expect(error._tag).toBe("ZeropsInvalidTokenError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails with ZeropsApiUnavailableError on an unexpected status", () => {
    const { layer } = stub(() => new Response(null, { status: 503 }));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsAuth.verifyBearerToken({ apiBaseUrl: "https://api.example.test", token: "t" }),
      );
      expect(error._tag).toBe("ZeropsApiUnavailableError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails with ZeropsApiUnavailableError when the user read carries no id", () => {
    const { layer } = stub(() => json({}));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        ZeropsAuth.verifyBearerToken({ apiBaseUrl: "https://api.example.test", token: "t" }),
      );
      expect(error._tag).toBe("ZeropsApiUnavailableError");
    }).pipe(Effect.provide(layer));
  });
});
