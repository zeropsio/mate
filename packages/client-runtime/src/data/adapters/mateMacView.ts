/** One demanded Mac live view per Mate: the account store holds its state and window. */
import {
  EnvironmentAuthorizationError,
  WS_METHODS,
  type EnvironmentId,
  type ZeropsMacStreamEvent,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { createEnvironmentRpcCommand } from "../../state/runtime.ts";
import { foldMacViewEvent, INITIAL_MAC_VIEW_STATE } from "../../zerops/macView.ts";
import { mateMacViewId, mateMacViewScope } from "../families/mateMacView.ts";
import type { LinkKey } from "../model.ts";
import { streamOf, type Row } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import type { StreamEvent, StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";

export function makeMateMacViewSink({
  store,
  environmentId,
}: {
  readonly store: AccountStore;
  readonly environmentId: string;
}) {
  const scope = mateMacViewScope(environmentId);
  const id = mateMacViewId(environmentId);
  const retained = readsOfState(store.state()).fact("mateMacView", id);
  let state = retained.kind === "known" ? retained.value.state : INITIAL_MAC_VIEW_STATE;
  let currentFrame = false;
  let based = false;
  const prior = store.state().facts.get(`mateMacView:${id}`)?.revision;
  let sequence = prior?.kind === "mate-link" ? prior.sequence : 0;
  const signal = (event: StreamEvent, now: number) =>
    store.dispatch({ kind: "stream", key: scope, now, event });
  let generation: number | null = null;
  return {
    session(now = 0) {
      based = false;
      currentFrame = false;
      signal({ kind: "demand", demanded: true }, now);
      signal({ kind: "attempt" }, now);
      signal({ kind: "handshake" }, now);
      generation = streamOf(store.state(), scope).generation;
    },
    event(event: ZeropsMacStreamEvent, now = 0) {
      const source = streamOf(store.state(), scope);
      if (
        generation === null ||
        source.generation !== generation ||
        source.phase === "refused" ||
        source.phase === "paused"
      )
        return;
      state = foldMacViewEvent(state, event);
      if (event.type === "frame") currentFrame = true;
      else if (event.status !== "live") currentFrame = false;
      const rows: Row[] = [
        {
          family: "mateMacView",
          id,
          value: { state, currentFrame },
          revision: { kind: "mate-link", sequence: ++sequence },
        },
      ];
      if (!based) {
        store.dispatch({ kind: "baseline-begin", scope, generation });
        store.dispatch({
          kind: "baseline-commit",
          scope,
          generation,
          via: "mate-direct",
          members: [id],
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
      }
    },
    lost(fault: StreamFault, now = 0) {
      if (generation !== null && streamOf(store.state(), scope).generation !== generation) return;
      if (fault.outcome === "definitive-refusal") {
        store.dispatch({ kind: "access", family: "mateMacView", id, access: "denied" });
      }
      signal({ kind: "fault", fault, jitter: 0 }, now);
    },
  };
}

export type MateMacViewEvent =
  | { readonly kind: "session" }
  | { readonly kind: "session-lost" }
  | { readonly kind: "event"; readonly event: ZeropsMacStreamEvent };
export class MateMacViewLost extends Data.TaggedError("MateMacViewLost")<{
  readonly message: string;
}> {}
export interface MateMacViewWire {
  readonly open: Stream.Stream<MateMacViewEvent, EnvironmentAuthorizationError | MateMacViewLost>;
}
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const textOf = (value: unknown): string => (value instanceof Error ? value.message : String(value));
export function classifyMateMacViewFailure(cause: Cause.Cause<unknown>): StreamFault {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason) && isAuthorizationError(reason.error))
      return { outcome: "definitive-refusal", message: reason.error.message };
    if (Cause.isDieReason(reason) && textOf(reason.defect).startsWith("Unknown request tag"))
      return { outcome: "definitive-refusal", message: "This Mate does not show a Mac." };
  }
  return { outcome: "transient", message: textOf(Cause.squash(cause)) };
}
export function makeMateMacViewWire(options: {
  readonly registry: EnvironmentRegistry["Service"];
  readonly environmentId: EnvironmentId;
}): MateMacViewWire {
  const sessions = Stream.unwrap(
    Effect.map(EnvironmentSupervisor, (supervisor) =>
      SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap(
          Option.match({
            onNone: () => Stream.make({ kind: "session-lost" } as const),
            onSome: (session) =>
              Stream.concat(
                Stream.make({ kind: "session" } as const),
                session.client[WS_METHODS.subscribeZeropsMacStream]({}).pipe(
                  Stream.map((event): MateMacViewEvent => ({ kind: "event", event })),
                  Stream.mapError((error) =>
                    isAuthorizationError(error)
                      ? error
                      : new MateMacViewLost({ message: error.message }),
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
export function startMateMacView(options: {
  readonly environmentId: string;
  readonly store: AccountStore;
  readonly wire: MateMacViewWire;
}) {
  const { store, environmentId, wire } = options;
  const key: LinkKey = `mate:mac-${environmentId}`;
  const scope = mateMacViewScope(environmentId);
  const sink = makeMateMacViewSink({ store, environmentId });
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
            const fault = classifyMateMacViewFailure(cause);
            sink.lost(fault, yield* Clock.currentTimeMillis);
            return yield* Effect.fail(fault);
          }),
        ),
      );
      return yield* Effect.fail({
        outcome: "transient",
        message: "The Mate's Mac view ended.",
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

/** A click or typed text for the Mac's app, on the same typed Mate transport as the view. */
export function makeMateMacInputCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcCommand(runtime, {
    label: "environment-data:zerops:macInput",
    tag: WS_METHODS.zeropsMacInput,
  });
}
