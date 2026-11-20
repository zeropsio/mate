import { EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ZeropsMateConnectionTarget } from "../../connection/model.ts";
import { remoteHttpClientLayer } from "../../rpc/http.ts";
import { fetchEnvironmentSessionState } from "./mateClientAccess.ts";

const target = new ZeropsMateConnectionTarget({
  environmentId: EnvironmentId.make("mate-1"),
  label: "Mate",
  orgId: "org-1",
  projectId: "project-1",
  httpBaseUrl: "https://mate.example.test/mate",
});

const session: AuthSessionState = {
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "t3_session",
  },
  scopes: ["access:read"],
  sessionMethod: "bearer-access-token",
};

// witness: packages/client-runtime/src/data/adapters/mateClientAccess.ts | withEnvironmentCredentials(input.prepared.httpAuthorization, client.session({ headers })) → withEnvironmentCredentials(null, client.session({ headers }))
it.effect(
  "AD34: A Mate's protected session read carries its ticket and no cookie or DPoP credential",
  () =>
    Effect.gen(function* () {
      const requests: Request[] = [];
      const http = remoteHttpClientLayer((input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(Response.json(session));
      });
      const result = yield* fetchEnvironmentSessionState({
        prepared: {
          environmentId: target.environmentId,
          label: target.label,
          httpBaseUrl: target.httpBaseUrl,
          socketUrl: "wss://mate.example.test/mate/ws",
          firstFrame: '{"ticket":"current-ticket"}',
          httpAuthorization: { _tag: "Bearer", token: "current-ticket" },
          target,
        },
        signer: Option.none(),
        timeoutMs: 60_000,
      }).pipe(Effect.provide(http));

      expect(result.authenticated).toBe(true);
      expect(
        requests.map(({ url, headers, credentials }) => ({
          url,
          authorization: headers.get("authorization"),
          dpop: headers.get("dpop"),
          credentials,
        })),
      ).toEqual([
        {
          url: "https://mate.example.test/mate/api/auth/session",
          authorization: "Bearer current-ticket",
          dpop: null,
          credentials: "omit",
        },
      ]);
    }),
);
