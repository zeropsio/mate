// @effect-diagnostics nodeBuiltinImport:off -- the scenario harness speaks to disposable loopback services.
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import { makeHttpCall } from "../harness/httpCall.ts";
import { openScenarioNavigation, type ScenarioCore } from "../harness/hqCore.ts";
import { serve, type WireRequest } from "../harness/http.ts";
import { personDoor } from "../harness/mateAccess.ts";

it.effect(
  'Decision: One owner for "how a test person calls HQ": the harness\'s `core.call` (or one helper beside it) adds the token from the person; fixtures never hand-build headers or bodies with tokens.',
  () =>
    Effect.gen(function* () {
      const requests: WireRequest[] = [];
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve((request) => {
            requests.push(request);
            return request.url.pathname === "/api/door"
              ? { body: { session: `session-${String(request.body.accessToken)}` } }
              : { body: {} };
          }),
        ),
        (server) => Effect.promise(server.close),
      );
      const call = makeHttpCall(new URL(server.origin).host);
      const core = { call } as ScenarioCore;
      const owner = yield* personDoor(core, "owner");
      const reader = yield* personDoor(core, "reader");
      expect(requests.slice(0, 2).map(({ body }) => body)).toEqual([
        { accessToken: "personal", orgId: "ORG" },
        { accessToken: "personal-reader", orgId: "ORG" },
      ]);
      yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
      yield* call("POST", "/api/apps", { session: reader, body: { name: "Other" } });
      yield* call("POST", "/api/mate/changes", {
        headers: { authorization: "Project mate-key" },
        body: { title: "Change" },
      });
      expect(requests.slice(2).map(({ body }) => body)).toEqual([
        { name: "Shop", accessToken: "personal" },
        { name: "Other", accessToken: "personal-reader" },
        { title: "Change" },
      ]);
    }).pipe(Effect.scoped),
);

it.effect(
  "Decision: Protected stream scopes the scenarios subscribe to carry the token the same way the client does (hqStream.ts:80); no scenario pins a `token_required` that the product would not show.",
  () =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      const scope = { kind: "attention", projectId: "Ada" } as const;
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve(
            () => undefined,
            (socket) => {
              socket.on("message", (frame) => {
                requests.push(
                  Schema.decodeUnknownSync(Schema.fromJsonString(HqStreamRequest))(
                    frame.toString(),
                  ),
                );
                socket.send(
                  JSON.stringify({ type: "scope-ready", scope, incarnation: "core", revision: 1 }),
                );
              });
            },
          ),
        ),
        (server) => Effect.promise(server.close),
      );
      yield* openScenarioNavigation(
        server.origin,
        "ticket",
        (message) => message.type === "scope-ready" && message.scope.kind === "attention",
        scope,
        "owner-token",
      );
      expect(requests).toEqual([
        { type: "subscribe", scopes: [{ scope }], accessToken: "owner-token" },
      ]);
    }).pipe(Effect.scoped),
);
