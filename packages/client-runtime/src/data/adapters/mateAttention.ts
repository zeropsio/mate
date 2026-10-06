/**
 * A Mate's attention straight from the Mate the person has open (`subscribeZeropsAttention`): one
 * link per Mate, by its project, observed only while the app holds the Mate open. Each session of
 * the Mate's socket starts its answer again: its first value is the scope's baseline, each later
 * one a push. Every value goes into the `mateAttention` family with the Mate's own revision, the
 * same family HQ's relay writes, and the reducer keeps the newer.
 *
 * The wire's session ending, or its stream failing, ends the attempt with a classified fault; a
 * Mate without the method (one from before the attention value) is `unsupported`, and HQ's relay
 * of its overview stays its word.
 *
 * @module data/adapters/mateAttention
 */
import {
  EnvironmentAuthorizationError,
  WS_METHODS,
  type EnvironmentId,
  type MateAttention,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";

import { mateAttentionScope } from "../families/mateAttention.ts";
import { linkKeys, type LinkKey, type ScopeKey } from "../model.ts";
import { streamOf } from "../reducer.ts";
import type { AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import type { LinkOptions } from "../supervisor.ts";

/** What one Mate's socket says of its attention: a session opening, its values, its end. */
export type MateAttentionEvent =
  | { readonly kind: "session" }
  | { readonly kind: "session-lost" }
  | { readonly kind: "value"; readonly value: MateAttention };

/** The Mate's socket failed under the attention stream: a transient, whatever its cause. */
export class MateAttentionLost extends Data.TaggedError("MateAttentionLost")<{
  readonly message: string;
}> {}

/** Today's Mate transport behind the adapter, or a fixture: its sessions' attention, in order. */
export interface MateAttentionWire {
  readonly open: Stream.Stream<
    MateAttentionEvent,
    EnvironmentAuthorizationError | MateAttentionLost
  >;
}

/** What an older server answers for a method it does not have (effect `RpcServer`). */
const UNKNOWN_REQUEST_TAG = "Unknown request tag";
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);

const defectText = (defect: unknown): string =>
  typeof defect === "string" ? defect : defect instanceof Error ? defect.message : String(defect);

/** How the wire's failure classifies: a Mate without the method, a refusal, or a transient. */
export function classifyMateAttentionFailure(
  cause: Cause.Cause<unknown>,
): StreamFault | "unsupported" {
  for (const reason of cause.reasons) {
    if (Cause.isDieReason(reason) && defectText(reason.defect).startsWith(UNKNOWN_REQUEST_TAG))
      return "unsupported";
    if (Cause.isFailReason(reason) && isAuthorizationError(reason.error))
      return { outcome: "definitive-refusal", message: reason.error.message };
  }
  return {
    outcome: "transient",
    message: `The Mate's attention stopped (${defectText(Cause.squash(cause))}).`,
  };
}

const SESSION_LOST: StreamFault = {
  outcome: "transient",
  message: "The Mate's socket is not connected.",
};
const ENDED: StreamFault = { outcome: "transient", message: "The Mate's attention ended." };

export function mateAttentionLink(options: {
  readonly projectId: string;
  readonly wire: MateAttentionWire;
  readonly store: AccountStore;
}): Pick<LinkOptions, "key" | "scopes" | "attempt"> {
  const { projectId, wire, store } = options;
  const key: LinkKey = linkKeys.mate(projectId);
  const scope: ScopeKey = mateAttentionScope(projectId);

  const attempt = (): Effect.Effect<never, StreamFault, Scope.Scope> =>
    Effect.gen(function* () {
      const signal = (target: LinkKey | ScopeKey, event: StreamEvent) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          store.dispatch({ kind: "stream", key: target, now, event }),
        );
      /** Whether the session under way committed its baseline yet. */
      let based = false;
      const generation = () => streamOf(store.state(), scope).generation;

      const onEvent = (event: MateAttentionEvent): Effect.Effect<void, StreamFault> =>
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
              const row = {
                family: "mateAttention",
                id: projectId,
                value: event.value,
                revision: {
                  kind: "mate-attention",
                  environmentId: event.value.source.environmentId,
                  epoch: event.value.source.epoch,
                  incarnation: event.value.source.incarnation,
                  revision: event.value.source.revision,
                  live: true,
                },
              } as const;
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
          const classified = classifyMateAttentionFailure(cause);
          if (classified !== "unsupported") return Effect.fail(classified);
          return Effect.gen(function* () {
            yield* signal(scope, { kind: "unsupported" });
            yield* signal(key, { kind: "unsupported" });
            return yield* Effect.fail<StreamFault>({
              outcome: "definitive-refusal",
              message: "This Mate does not publish its attention.",
            });
          });
        }),
      );
      return yield* Effect.fail(ENDED);
    });

  return { key, scopes: [scope], attempt };
}

const isStreamFault = (error: unknown): error is StreamFault =>
  error === SESSION_LOST || error === ENDED;

const SESSION: MateAttentionEvent = { kind: "session" };
const LOST: MateAttentionEvent = { kind: "session-lost" };

/**
 * Today's transport: the Mate's socket in the app's connection registry. Each session asks for the
 * attention anew; no session is a lost one. A failure that is not the Mate's refusal is the socket
 * failing under it; a Mate without the method dies with the server's own words, which the link
 * reads as unsupported.
 */
export function makeMateAttentionWire(options: {
  readonly registry: EnvironmentRegistry["Service"];
  readonly environmentId: EnvironmentId;
}): MateAttentionWire {
  const sessions = Stream.unwrap(
    Effect.map(EnvironmentSupervisor, (supervisor) =>
      SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.make(LOST),
            onSome: (session) =>
              Stream.concat(
                Stream.make(SESSION),
                session.client[WS_METHODS.subscribeZeropsAttention]({}).pipe(
                  Stream.map((value): MateAttentionEvent => ({ kind: "value", value })),
                  Stream.mapError((error) =>
                    isAuthorizationError(error)
                      ? error
                      : new MateAttentionLost({ message: error.message }),
                  ),
                ),
              ),
          }),
        ),
      ),
    ),
  );
  return { open: options.registry.followStream(options.environmentId, sessions) };
}
