import { EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ZeropsMateConnectionTarget } from "../../connection/model.ts";
import { remoteHttpClientLayer } from "../../rpc/http.ts";
import { fetchEnvironmentSessionState } from "./mateClientAccess.ts";

it.effect(
  "A Mate's protected session read uses its ticket without cookies or a DPoP credential",
  () =>
    Effect.gen(function* () {
      const requests: Request[] = [];
      const target = new ZeropsMateConnectionTarget({
        environmentId: EnvironmentId.make("mate-1"),
        label: "Mate",
        orgId: "org-1",
        projectId: "project-1",
        httpBaseUrl: "https://mate.example.test/mate",
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
      }).pipe(
        Effect.provide(
          remoteHttpClientLayer((input, init) => {
            requests.push(new Request(input, init));
            return Promise.resolve(
              Response.json({
                authenticated: true,
                auth: {
                  policy: "remote-reachable",
                  bootstrapMethods: [],
                  sessionMethods: ["bearer-access-token"],
                  sessionCookieName: "t3_session",
                },
                scopes: ["access:read"],
                sessionMethod: "bearer-access-token",
              } satisfies AuthSessionState),
            );
          }),
        ),
      );
      expect(result.authenticated).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://mate.example.test/mate/api/auth/session");
      expect(requests[0]?.headers.get("authorization")).toBe("Bearer current-ticket");
      expect(requests[0]?.headers.get("dpop")).toBeNull();
      expect(requests[0]?.credentials).toBe("omit");
    }),
);
