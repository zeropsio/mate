import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import { ConnectionAdmissionRef } from "./admission.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import {
  ConnectionTransientError,
  type ConnectionAttemptError,
  type ConnectionAttemptStage,
  type PreparedConnection,
} from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";
import * as RpcSession from "../rpc/session.ts";

export type ConnectionDriverProgress =
  | {
      readonly stage: "preparing";
    }
  | {
      readonly stage: Exclude<ConnectionAttemptStage, "preparing">;
      readonly prepared: PreparedConnection;
    };

export interface EnvironmentConnectionLease {
  readonly prepared: PreparedConnection;
  readonly session: RpcSession.RpcSession;
}

export class ConnectionDriver extends Context.Service<
  ConnectionDriver,
  {
    readonly connect: (
      entry: ConnectionCatalogEntry,
      reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
      /** Told while the attempt waits its turn for a socket (`admission.ts`), and when it ends. */
      queue?: (waiting: boolean) => Effect.Effect<void>,
    ) => Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, Scope.Scope>;
  }
>()("@t3tools/client-runtime/connection/driver/ConnectionDriver") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const resolver = yield* ConnectionResolver.ConnectionResolver;
  const sessions = yield* RpcSession.RpcSessionFactory;

  const connect = Effect.fn("ConnectionDriver.connect")(function* (
    entry: ConnectionCatalogEntry,
    reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
    queue: (waiting: boolean) => Effect.Effect<void> = () => Effect.void,
  ) {
    const target = entry.target;
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": target.environmentId,
      "connection.target.kind": target._tag,
    });
    yield* reportProgress({ stage: "preparing" });
    const prepared = yield* resolver.prepare(entry);
    yield* reportProgress({ stage: "opening", prepared });
    // The socket waits its turn for the browser's one CONNECTING slot (`admission.ts`), and holds
    // it only until it opens: synchronizing runs outside. Acquired and released in one region no
    // interruption splits, so a ticket is never left holding the others.
    const admission = yield* ConnectionAdmissionRef;
    const session = yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* queue(true);
        const ticket = yield* restore(
          Effect.promise((signal) => admission.admit(target.environmentId, signal)),
        ).pipe(Effect.ensuring(queue(false)));
        ticket.claim();
        yield* Effect.addFinalizer(() => Effect.sync(ticket.close));
        const yielded = Effect.callback<never, ConnectionTransientError>((resume) => {
          const give = () =>
            resume(
              Effect.fail(
                new ConnectionTransientError({
                  reason: "transport",
                  detail: `${target.label} gave way to another connection.`,
                }),
              ),
            );
          if (ticket.signal.aborted) give();
          else ticket.signal.addEventListener("abort", give, { once: true });
          return Effect.sync(() => ticket.signal.removeEventListener("abort", give));
        });
        const opening = Effect.gen(function* () {
          const opened = yield* sessions.connect(prepared);
          yield* opened.opened ?? opened.ready;
          return opened;
        });
        return yield* restore(Effect.raceFirst(opening, yielded)).pipe(
          Effect.onExit((exit) => Effect.sync(() => ticket.settle(Exit.isSuccess(exit)))),
        );
      }),
    );
    yield* reportProgress({ stage: "synchronizing", prepared });
    yield* session.ready;
    return { prepared, session } satisfies EnvironmentConnectionLease;
  });

  return ConnectionDriver.of({ connect });
});

export const layer = Layer.effect(ConnectionDriver, make);
