import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

import { withEnvironmentCredentials } from "./environmentHttpAuth.ts";

describe("withEnvironmentCredentials", () => {
  it.effect("keeps cookies for same-origin requests and omits them cross-origin", () =>
    Effect.gen(function* () {
      const requestInit = yield* withEnvironmentCredentials(null, FetchHttpClient.RequestInit).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, {
          credentials: "omit",
        }),
      );

      // Fetch evaluates this mode against the browser's own execution origin:
      // same-origin requests include cookies and cross-origin requests do not.
      expect(requestInit.credentials).toBe("same-origin");
    }),
  );

  it.effect("does not override credential mode for bearer-authenticated requests", () =>
    Effect.gen(function* () {
      const requestInit = yield* withEnvironmentCredentials(
        { _tag: "Bearer", token: "access-token" },
        FetchHttpClient.RequestInit,
      ).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, {
          credentials: "omit",
        }),
      );

      expect(requestInit.credentials).toBe("omit");
    }),
  );
});
