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
  ) {
    const target = entry.target;
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": target.environmentId,
      "connection.target.kind": target._tag,
    });
    yield* reportProgress({ stage: "preparing" });
    // The route's socket opens first and never behind another (`admission.ts`): the ticket is
    // asked for once admitted, and an attempt told to give way ends, closing its socket.
    const admission = yield* ConnectionAdmissionRef;
    const ticket = yield* Effect.promise((signal) => admission.admit(target.environmentId, signal));
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
    const attempt = Effect.gen(function* () {
      const prepared = yield* resolver.prepare(entry);
      yield* reportProgress({ stage: "opening", prepared });
      const session = yield* sessions.connect(prepared);
      yield* reportProgress({ stage: "synchronizing", prepared });
      yield* session.ready;
      return { prepared, session } satisfies EnvironmentConnectionLease;
    });
    const lease = yield* Effect.raceFirst(attempt, yielded).pipe(
      Effect.onExit((exit) => Effect.sync(() => ticket.settle(Exit.isSuccess(exit)))),
    );
    yield* Effect.addFinalizer(() => Effect.sync(ticket.close));
    return lease;
  });

  return ConnectionDriver.of({ connect });
});

export const layer = Layer.effect(ConnectionDriver, make);
