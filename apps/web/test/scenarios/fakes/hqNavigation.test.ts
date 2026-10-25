// @effect-diagnostics nodeBuiltinImport:off -- navigation is exercised over real loopback sockets.
import { expect, it } from "@effect/vitest";
import { HqStreamRequest } from "@t3tools/shared/hqStream";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { openScenarioNavigation } from "../harness/hqCore.ts";
import { serve } from "../harness/http.ts";

const readRequest = Schema.decodeUnknownSync(Schema.fromJsonString(HqStreamRequest));

it.effect(
  "a scenario navigation against a Core that pings and never readies fails on its refusal, naming it",
  () =>
    Effect.gen(function* () {
      const requests: HqStreamRequest[] = [];
      const closed = Promise.withResolvers<void>();
      const core = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve(
            () => undefined,
            (socket) => {
              socket.once("close", () => closed.resolve());
              socket.on("message", (frame) => {
                const request = readRequest(frame.toString());
                requests.push(request);
                if (request.type !== "subscribe") return;
                socket.send(JSON.stringify({ type: "ping" }));
                socket.send(
                  JSON.stringify({
                    type: "scope-error",
                    scope: { kind: "navigation" },
                    code: "zerops_refused",
                    reason: "test HQ access is missing",
                    disposition: "refused",
                  }),
                );
              });
            },
          ),
        ),
        (core) => Effect.promise(core.close),
      );
      const result = yield* Effect.exit(
        openScenarioNavigation(core.origin, "ticket").pipe(Effect.scoped),
      );
      yield* Effect.promise(() => closed.promise);
      expect(requests).toEqual([
        { type: "subscribe", scopes: [{ scope: { kind: "navigation" } }] },
        { type: "pong" },
      ]);
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain(
          "Core navigation failed (zerops_refused): test HQ access is missing",
        );
        expect(Cause.pretty(result.cause)).not.toContain("4408");
      }
    }).pipe(Effect.scoped),
);

it.effect("scenario navigation ignores another scope's failure while answering Core pings", () =>
  Effect.gen(function* () {
    const requests: HqStreamRequest[] = [];
    const core = yield* Effect.acquireRelease(
      Effect.promise(() =>
        serve(
          () => undefined,
          (socket) => {
            socket.on("message", (frame) => {
              const request = readRequest(frame.toString());
              requests.push(request);
              if (request.type === "subscribe") {
                socket.send(
                  JSON.stringify({
                    type: "scope-error",
                    scope: { kind: "app-detail", appId: "other" },
                    code: "not_found",
                    reason: null,
                    disposition: "refused",
                  }),
                );
                socket.send(JSON.stringify({ type: "ping" }));
              } else if (request.type === "pong") {
                socket.send(
                  JSON.stringify({
                    type: "scope-ready",
                    scope: { kind: "navigation" },
                    incarnation: "core",
                    revision: 1,
                  }),
                );
              }
            });
          },
        ),
      ),
      (core) => Effect.promise(core.close),
    );
    yield* openScenarioNavigation(core.origin, "ticket");
    expect(requests).toEqual([
      { type: "subscribe", scopes: [{ scope: { kind: "navigation" } }] },
      { type: "pong" },
    ]);
  }).pipe(Effect.scoped),
);
