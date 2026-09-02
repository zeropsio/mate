import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentOperationForbiddenError } from "@t3tools/contracts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { mintZeropsIdentityCredential } from "./zerops.ts";

const isForbidden = Schema.is(EnvironmentOperationForbiddenError);

type FetchCall = readonly [input: RequestInfo | URL, init: RequestInit];

const recordedFetch = (...responses: ReadonlyArray<Response>) => {
  const calls: Array<FetchCall> = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    if (!response) {
      return Promise.reject(new Error("Unexpected fetch call"));
    }
    return Promise.resolve(response);
  }) satisfies typeof fetch;
  return { fetchFn, calls };
};

const provideRemoteHttp = (fetchFn: typeof fetch) => Effect.provide(remoteHttpClientLayer(fetchFn));

const requestHeaders = (call: FetchCall | undefined): Record<string, string> =>
  (call?.[1].headers as Record<string, string> | undefined) ?? {};

const credentialResponse = () =>
  Response.json(
    {
      id: "grant-1",
      credential: "a-pairing-credential",
      label: "Zerops OWNER",
      expiresAt: "2026-08-28T12:00:00.000Z",
    },
    { status: 200 },
  );

describe("mintZeropsIdentityCredential", () => {
  it.effect("posts the Zerops token to the identity door and returns the credential", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(credentialResponse());

      const result = yield* mintZeropsIdentityCredential({
        httpBaseUrl: "https://zcp-26a7-8080.prg1.zerops.app",
        zeropsToken: "a-zerops-access-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(result.credential).toBe("a-pairing-credential");
      expect(result.label).toBe("Zerops OWNER");

      const call = fetch.calls[0];
      expect(call).toBeDefined();
      expect(String(call?.[0])).toBe(
        "https://zcp-26a7-8080.prg1.zerops.app/api/auth/zerops-identity",
      );
      expect(call?.[1].method).toBe("POST");
      // The Zerops token travels in the body, never as this request's own
      // Authorization header: it is the subject being proven, not a bearer.
      expect(requestHeaders(call).authorization).toBeUndefined();
    }),
  );

  it.effect("addresses the door below the base path the environment is served under", () =>
    Effect.gen(function* () {
      // The request URL comes from the contract client's base
      // (`rpc/http.ts` `remoteApiBaseUrl`), which keeps the prefix and lets
      // `prependUrl` join the route onto it; `environmentEndpointUrl` only
      // labels error messages. Every client call has this shape, not just
      // this one.
      const fetch = recordedFetch(credentialResponse());

      yield* mintZeropsIdentityCredential({
        httpBaseUrl: "https://zcp-26a7-8080.prg1.zerops.app/mate/",
        zeropsToken: "a-zerops-access-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(String(fetch.calls[0]?.[0])).toBe(
        "https://zcp-26a7-8080.prg1.zerops.app/mate/api/auth/zerops-identity",
      );
    }),
  );

  it.effect("sends a DPoP proof when the client binds its token to a key", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(credentialResponse());

      yield* mintZeropsIdentityCredential({
        httpBaseUrl: "https://remote.example.com",
        zeropsToken: "a-zerops-access-token",
        dpopProof: "a-dpop-proof",
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(requestHeaders(fetch.calls[0]).dpop).toBe("a-dpop-proof");
    }),
  );

  it.effect("surfaces the server's refusal of a non-member as a typed error", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(
        Response.json(
          {
            _tag: "EnvironmentOperationForbiddenError",
            code: "operation_forbidden",
            reason: "zerops_project_membership_required",
            traceId: "trace-1",
          },
          { status: 403 },
        ),
      );

      const error = yield* Effect.flip(
        mintZeropsIdentityCredential({
          httpBaseUrl: "https://remote.example.com",
          zeropsToken: "a-zerops-access-token",
        }).pipe(provideRemoteHttp(fetch.fetchFn)),
      );

      expect(isForbidden(error)).toBe(true);
    }),
  );
});
