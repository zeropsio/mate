// @effect-diagnostics globalFetch:off globalFetchInEffect:off -- actual private HTTP adapter witness.
import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { serveOpenCodeToolExecution } from "./openCodeToolExecution.ts";

const instance = ProviderInstanceId.make("opencode");
const body = {
  sessionID: "native-session",
  messageID: "native-message",
  callID: "native-call",
  input: { action: "open" },
};
const post = (url: string, token: string, value: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(value),
  });

describe("actual OpenCode workflow execution bridge", () => {
  it.effect(
    "delivers exact native metadata and leaves parent lookup lazy until the owned executor captures",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const bridge = yield* serveOpenCodeToolExecution(instance);
          let captured = false;
          let resolves = 0;
          bridge.registerSession(body.sessionID, {
            threadId: ThreadId.make("owned-thread"),
            resolveTurn: (identity) =>
              Effect.sync(() => {
                expect(captured).toBe(true);
                expect(identity.callId).toBe(body.callID);
                resolves++;
                return "opaque-original-send";
              }),
            prepare: () => Effect.succeed({ text: "prepared", isError: false }),
            execute: (input, invocation) =>
              Effect.gen(function* () {
                expect(resolves).toBe(0);
                captured = true;
                expect(invocation.identity).toEqual({
                  driver: "opencode",
                  instanceId: instance,
                  sessionId: body.sessionID,
                  messageId: body.messageID,
                  callId: body.callID,
                });
                expect(input).toEqual(body.input);
                expect(yield* invocation.resolveTurn()).toBe("opaque-original-send");
                return { text: "real execution receipt", isError: false };
              }),
          });
          const response = yield* Effect.promise(() => post(bridge.url, bridge.token, body));
          expect(response.status).toBe(200);
          expect(yield* Effect.promise(() => response.json())).toEqual({
            text: "real execution receipt",
            isError: false,
          });
          expect(resolves).toBe(1);
        }),
      ),
  );
  it.effect(
    "rejects unknown sessions, forged outer fields and unauthenticated callers before execution",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const bridge = yield* serveOpenCodeToolExecution(instance);
          let calls = 0;
          bridge.registerSession(body.sessionID, {
            threadId: ThreadId.make("thread"),
            resolveTurn: () => Effect.succeed(undefined),
            prepare: () => Effect.succeed({ text: "prepared", isError: false }),
            execute: () =>
              Effect.sync(() => {
                calls++;
                return { text: "done", isError: false };
              }),
          });
          for (const [token, value, status] of [
            ["wrong", body, 403],
            [bridge.token, { ...body, sessionID: "unknown" }, 403],
            [bridge.token, { ...body, originatingTask: { taskId: "forged" } }, 400],
            [bridge.token, { ...body, callID: "" }, 400],
          ] as const) {
            expect((yield* Effect.promise(() => post(bridge.url, token, value))).status).toBe(
              status,
            );
          }
          expect(calls).toBe(0);
        }),
      ),
  );
  it.effect("closing its provider cancels and joins an executing tool before returning", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const entered = yield* Deferred.make<void>();
        const ended = yield* Deferred.make<void>();
        const bridge = yield* serveOpenCodeToolExecution(instance).pipe(
          Effect.provideService(Scope.Scope, scope),
        );
        bridge.registerSession(body.sessionID, {
          threadId: ThreadId.make("thread"),
          resolveTurn: () => Effect.succeed(undefined),
          prepare: () => Effect.succeed({ text: "prepared", isError: false }),
          execute: () =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(ended, undefined)),
            ),
        });
        const request = post(bridge.url, bridge.token, body).catch(() => undefined);
        yield* Deferred.await(entered);
        yield* Scope.close(scope, Exit.void);
        expect(yield* Deferred.isDone(ended)).toBe(true);
        yield* Effect.promise(() => request);
        yield* Effect.promise(() =>
          fetch(bridge.url).then(
            () => {
              throw new Error("closed bridge still served");
            },
            () => undefined,
          ),
        );
      }),
    ),
  );
  it.effect(
    "static workflow is allowed only for a registered manual root and never for managed or unknown child sessions",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const bridge = yield* serveOpenCodeToolExecution(instance);
          const release = bridge.registerSession(body.sessionID, {
            threadId: ThreadId.make("root"),
            resolveTurn: () => Effect.succeed(undefined),
            prepare: () => Effect.succeed({ text: "prepared", isError: false }),
            execute: () => Effect.succeed({ text: "done", isError: false }),
          });
          const policy = (sessionID: string) =>
            Effect.promise(() =>
              post(new URL("/policy", bridge.url).href, bridge.token, { sessionID }).then((r) =>
                r.json(),
              ),
            );
          expect(yield* policy(body.sessionID)).toEqual({ allowStaticWorkflow: true });
          expect(yield* policy("unknown-native-child")).toEqual({ allowStaticWorkflow: false });
          bridge.markManaged(body.sessionID);
          expect(yield* policy(body.sessionID)).toEqual({ allowStaticWorkflow: false });
          release();
          bridge.registerSession(body.sessionID, {
            threadId: ThreadId.make("same-native-root-reopened"),
            resolveTurn: () => Effect.succeed(undefined),
            prepare: () => Effect.succeed({ text: "prepared", isError: false }),
            execute: () => Effect.succeed({ text: "done", isError: false }),
          });
          expect(yield* policy(body.sessionID)).toEqual({ allowStaticWorkflow: false });
        }),
      ),
  );
});
