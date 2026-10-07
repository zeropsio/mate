/** Shared session, refusal and baseline semantics for the two source-owned Mate facts. */
import { EnvironmentAuthorizationError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { LinkKey, ScopeKey } from "../model.ts";
import { streamOf, type Row } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import type { LinkOptions } from "../supervisor.ts";

export type MateSourceEvent<Value> =
  | { readonly kind: "session" }
  | { readonly kind: "session-lost" }
  | { readonly kind: "value"; readonly value: Value };

/** What an older server answers for a method it does not have (effect `RpcServer`). */
const UNKNOWN_REQUEST_TAG = "Unknown request tag";
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

const defectText = (defect: unknown): string =>
  typeof defect === "string" ? defect : defect instanceof Error ? defect.message : String(defect);

/** How the wire's failure classifies: a Mate without the method, a refusal, or a transient. */
export function classifyMateSourceFailure(
  cause: Cause.Cause<unknown>,
  label: string,
): StreamFault | "unsupported" {
  for (const reason of cause.reasons) {
    if (Cause.isDieReason(reason) && defectText(reason.defect).startsWith(UNKNOWN_REQUEST_TAG))
      return "unsupported";
    if (Cause.isFailReason(reason) && isAuthorizationError(reason.error))
      return { outcome: "definitive-refusal", message: reason.error.message };
  }
  return {
    outcome: "transient",
    message: `The Mate's ${label} stopped (${defectText(Cause.squash(cause))}).`,
  };
}

const SESSION_LOST: StreamFault = {
  outcome: "transient",
  message: "The Mate's socket is not connected.",
};

export function mateSourceLink<Value, WireError>(options: {
  readonly projectId: string;
  readonly wire: { readonly open: Stream.Stream<MateSourceEvent<Value>, WireError> };
  readonly store: AccountStore;
  readonly key: LinkKey;
  readonly scope: ScopeKey;
  readonly label: string;
  readonly row: (value: Value) => Row;
}): Pick<LinkOptions, "key" | "scopes" | "attempt"> {
  const { projectId, wire, store, key, scope, label } = options;
  const ENDED: StreamFault = { outcome: "transient", message: `The Mate's ${label} ended.` };
  const isStreamFault = (error: unknown): error is StreamFault =>
    error === SESSION_LOST || error === ENDED;

  const attempt = (): Effect.Effect<never, StreamFault, Scope.Scope> =>
    Effect.gen(function* () {
      const signal = (target: LinkKey | ScopeKey, event: StreamEvent) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      /** Whether the session under way committed its baseline yet. */
      let based = false;
      const generation = () => streamOf(store.state(), scope).generation;

      const onEvent = (event: MateSourceEvent<Value>): Effect.Effect<void, StreamFault> =>
        Effect.gen(function* () {
          switch (event.kind) {
            case "session-lost":
              return yield* Effect.fail(SESSION_LOST);
            case "session":
              based = false;
              yield* signal(key, { kind: "handshake" });
              yield* signal(scope, { kind: "attempt" });
              yield* signal(scope, { kind: "handshake" });
              return;
            case "value": {
              const row = options.row(event.value);
              if (based) {
                store.dispatch({
                  kind: "rows",
                  scope,
                  generation: generation(),
                  method: "push",
                  via: "mate-direct",
                  rows: [row],
                });
                return;
              }
              store.dispatch({ kind: "baseline-begin", scope, generation: generation() });
              store.dispatch({
                kind: "baseline-commit",
                scope,
                generation: generation(),
                via: "mate-direct",
                members: [projectId],
                rows: [row],
              });
              based = true;
              yield* signal(key, { kind: "baseline-committed" });
              yield* signal(scope, { kind: "baseline-committed" });
              return;
            }
          }
        });

      yield* Stream.runForEach(wire.open, onEvent).pipe(
        Effect.catchCause((cause) => {
          const fault = Cause.findErrorOption(cause);
          // A fault this attempt classified itself ends it as it is.
          if (fault._tag === "Some" && isStreamFault(fault.value)) return Effect.fail(fault.value);
          const classified = classifyMateSourceFailure(cause, label);
          if (classified !== "unsupported") return Effect.fail(classified);
          return Effect.gen(function* () {
            yield* signal(scope, { kind: "unsupported" });
            yield* signal(key, { kind: "unsupported" });
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: `This Mate does not publish its ${label}.`,
            });
          });
        }),
      );
      return yield* Effect.fail(ENDED);
    });

  return { key, scopes: [scope], attempt };
}
