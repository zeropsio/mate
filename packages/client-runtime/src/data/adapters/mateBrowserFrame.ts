import { Atom } from "effect/unstable/reactivity";
import { createEnvironmentRpcCommand } from "../../state/runtime.ts";
/** One demanded Mate browser relay. Source identity, never the mounted card, chooses a call slot. */
import {
  EnvironmentAuthorizationError,
  WS_METHODS,
  type EnvironmentId,
  type ZeropsBrowserStreamEvent,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import {
  foldBrowserStreamEvent,
  INITIAL_BROWSER_STREAM_STATE,
} from "../../zerops/browserStream.ts";
import {
  mateBrowserFrameId,
  mateBrowserFrameScope,
  mateBrowserStreamId,
} from "../families/mateBrowserFrame.ts";
import type { LinkKey } from "../model.ts";
import { streamOf, type Row } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";

export function makeMateBrowserFrameSink({
  store,
  environmentId,
}: {
  readonly store: AccountStore;
  readonly environmentId: string;
}) {
  const scope = mateBrowserFrameScope(environmentId);
  const streamId = mateBrowserStreamId(environmentId);
  const retained = readsOfState(store.state()).fact("mateBrowserFrame", streamId);
  let state =
    retained.kind === "known" && retained.value.kind === "stream"
      ? retained.value.state
      : INITIAL_BROWSER_STREAM_STATE;
  let currentFrame = false;
  let observedCalls: ReadonlyMap<string, number> = new Map();
  let based = false;
  const prior = store.state().facts.get(`mateBrowserFrame:${streamId}`)?.revision;
  let sequence = prior?.kind === "mate-link" ? prior.sequence : 0;
  const signal = (event: StreamEvent, now: number) =>
    store.dispatch({ kind: "stream", key: scope, now, event });
  let generation: number | null = null;
  return {
    session(now = 0) {
      based = false;
      currentFrame = false;
      observedCalls = new Map();
      signal({ kind: "demand", demanded: true }, now);
      signal({ kind: "attempt" }, now);
      signal({ kind: "handshake" }, now);
      generation = streamOf(store.state(), scope).generation;
    },
    event(event: ZeropsBrowserStreamEvent, now = 0) {
      const source = streamOf(store.state(), scope);
      if (
        generation === null ||
        source.generation !== generation ||
        source.phase === "refused" ||
        source.phase === "paused"
      )
        return;
      const next = foldBrowserStreamEvent(state, event);
      // Connection state hides a frame at the read; it never erases the source payload.
      state =
        next.frame === undefined && state.frame !== undefined
          ? { ...next, frame: state.frame }
          : next;
      if (event.type === "frame") currentFrame = true;
      else if (event.type === "state" && event.status !== "live") currentFrame = false;
      const rows: Row[] = [];
      if (
        event.type !== "state" &&
        event.callId !== undefined &&
        event.threadId !== undefined &&
        event.turnId !== undefined &&
        event.revision !== undefined &&
        Number.isInteger(event.revision) &&
        event.revision >= 0 &&
        event.completeness === "complete"
      ) {
        const frame =
          event.type === "frame" ? event : event.type === "call-result" ? event.frame : undefined;
        if (frame !== undefined) {
          const id = mateBrowserFrameId(environmentId, event.threadId, event.turnId, event.callId);
          if ((observedCalls.get(id) ?? -1) < event.revision)
            observedCalls = new Map(observedCalls).set(id, event.revision);
          rows.push({
            family: "mateBrowserFrame",
            id,
            value: {
              kind: "call",
              callId: event.callId,
              threadId: event.threadId,
              turnId: event.turnId,
              revision: event.revision,
              frame,
            },
            revision: {
              kind: "mate-browser-frame",
              callId: event.callId,
              revision: event.revision,
            },
          });
        }
      }
      rows.unshift({
        family: "mateBrowserFrame",
        id: streamId,
        value: { kind: "stream", state, currentFrame, observedCalls },
        revision: { kind: "mate-link", sequence: ++sequence },
      });
      if (!based) {
        store.dispatch({ kind: "baseline-begin", scope, generation });
        store.dispatch({
          kind: "baseline-commit",
          scope,
          generation,
          via: "mate-direct",
          members: rows.map((row) => row.id),
          rows,
        });
        signal({ kind: "baseline-committed" }, now);
        based = true;
      } else {
        store.dispatch({
          kind: "rows",
          scope,
          generation,
          method: "push",
          via: "mate-direct",
          rows,
        });
        store.dispatch({
          kind: "membership",
          scope,
          generation,
          delta: { add: rows.map((row) => row.id), remove: [] },
        });
      }
    },
    lost(fault: StreamFault, now = 0) {
      if (generation !== null && streamOf(store.state(), scope).generation !== generation) return;
      if (fault.outcome === "definitive-refusal") {
        for (const [key, fact] of store.state().facts) {
          if (!key.startsWith("mateBrowserFrame:") || fact.scope !== scope) continue;
          store.dispatch({
            kind: "access",
            family: "mateBrowserFrame",
            id: key.slice("mateBrowserFrame:".length),
            access: "denied",
          });
        }
      }
      signal({ kind: "fault", fault, jitter: 0 }, now);
    },
  };
}

export type MateBrowserFrameEvent =
  | { readonly kind: "session" }
  | { readonly kind: "session-lost" }
  | { readonly kind: "event"; readonly event: ZeropsBrowserStreamEvent };
export class MateBrowserFramesLost extends Data.TaggedError("MateBrowserFramesLost")<{
  readonly message: string;
}> {}
export interface MateBrowserFrameWire {
  readonly open: Stream.Stream<
    MateBrowserFrameEvent,
    EnvironmentAuthorizationError | MateBrowserFramesLost
  >;
}
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const textOf = (value: unknown): string => (value instanceof Error ? value.message : String(value));
export function classifyMateBrowserFrameFailure(cause: Cause.Cause<unknown>): StreamFault {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason) && isAuthorizationError(reason.error))
      return { outcome: "definitive-refusal", message: reason.error.message };
    if (Cause.isDieReason(reason) && textOf(reason.defect).startsWith("Unknown request tag"))
      return {
        outcome: "definitive-refusal",
        message: "This Mate does not publish browser frames.",
      };
  }
  return { outcome: "transient", message: textOf(Cause.squash(cause)) };
}
export function makeMateBrowserFrameWire(options: {
  readonly registry: EnvironmentRegistry["Service"];
  readonly environmentId: EnvironmentId;
}): MateBrowserFrameWire {
  const sessions = Stream.unwrap(
    Effect.map(EnvironmentSupervisor, (supervisor) =>
      SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.make({ kind: "session-lost" } as const),
            onSome: (session) =>
              Stream.concat(
                Stream.make({ kind: "session" } as const),
                session.client[WS_METHODS.subscribeZeropsBrowserStream]({ callFrames: true }).pipe(
                  Stream.map((event): MateBrowserFrameEvent => ({ kind: "event", event })),
                  Stream.mapError((error) =>
                    isAuthorizationError(error)
                      ? error
                      : new MateBrowserFramesLost({ message: error.message }),
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
export function startMateBrowserFrames(options: {
  readonly environmentId: string;
  readonly store: AccountStore;
  readonly wire: MateBrowserFrameWire;
}) {
  const { store, environmentId, wire } = options;
  const key: LinkKey = `mate:browser-${environmentId}`;
  const scope = mateBrowserFrameScope(environmentId);
  const sink = makeMateBrowserFrameSink({ store, environmentId });
  const attempt = () =>
    Effect.gen(function* () {
      yield* Stream.runForEach(wire.open, (event) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          if (event.kind === "session-lost")
            return yield* Effect.fail({
              outcome: "transient",
              message: "The Mate's socket is not connected.",
            } as const);
          if (event.kind === "session") {
            sink.session(now);
            store.dispatch({ kind: "stream", key, now, event: { kind: "handshake" } });
          } else {
            sink.event(event.event, now);
            store.dispatch({ kind: "stream", key, now, event: { kind: "baseline-committed" } });
          }
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const fault = classifyMateBrowserFrameFailure(cause);
            sink.lost(fault, yield* Clock.currentTimeMillis);
            return yield* Effect.fail(fault);
          }),
        ),
      );
      return yield* Effect.fail({
        outcome: "transient",
        message: "The Mate's browser relay ended.",
      } as const);
    });
  const supervisor = Effect.runSync(
    superviseLink({ key, scopes: [scope], store, attempt, repairSession: Effect.void }),
  );
  const fiber = Effect.runFork(supervisor.run);
  return {
    stop: () => {
      Effect.runSync(supervisor.release);
      void Effect.runFork(Fiber.interrupt(fiber));
    },
  };
}

/** Input belongs to the same typed Mate transport as frame observation; it keeps no result copy. */
export function makeMateBrowserInputCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:browserInput",
    tag: WS_METHODS.zeropsBrowserInput,
  });
}
