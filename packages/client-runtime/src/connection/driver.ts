import type { EnvironmentId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type { WebSocketLike } from "effect/socket/Socket";

import {
  ConnectionAdmissionRef,
  type AdmissionTicket,
  type ConnectionAdmission,
} from "./admission.ts";
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
      options?: {
        /**
         * The first attempt since the connection was asked for: the route's Mate's socket may be
         * dialed beside its ticket request ({@link SOCKET_AHEAD_MS}). A retry asks for its ticket
         * first, as every attempt did: a Mate that does not answer takes no turn from the others.
         */
        readonly ahead?: boolean;
      },
    ) => Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, Scope.Scope>;
  }
>()("@t3tools/client-runtime/connection/driver/ConnectionDriver") {}

/**
 * How long a socket dialed ahead may wait for its ticket, from its dial. A Mate refuses a socket
 * that presents no ticket within 5 s of its upgrade (`ws.ts`), and the upgrade is never before the
 * dial. Read against the clock when the ticket has come, not off a timer: a tab that stood still
 * finds its socket too old, and opens another.
 */
export const SOCKET_AHEAD_MS = 3_000;

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/**
 * The attempt's own socket, its handshake begun beside its ticket request instead of after it:
 * TCP, TLS and the upgrade run while HQ answers. Only the handshake is ahead: nothing is sent on
 * the socket until the attempt has its ticket, whose first frame it then is.
 *
 * It is the attempt's one socket and holds the attempt's one turn (`admission.ts`): `take` hands
 * both to the attempt, or closes the socket and gives the turn back before the attempt asks for
 * another. `end`, the attempt's finalizer, does the same at once, whatever the browser has said of
 * the socket by then.
 */
function dialAhead(input: {
  readonly admission: ConnectionAdmission;
  readonly environmentId: EnvironmentId;
  readonly socketUrl: string;
  readonly dial: (socketUrl: string) => WebSocketLike;
  readonly dialedAt: number;
}) {
  const turn = new AbortController();
  let ticket: AdmissionTicket | null = null;
  let socket: WebSocketLike | null = null;
  let taken = false;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    turn.abort();
    // Taken and never used (the attempt ended before its session began), it is closed here. Used,
    // its session closed it before this: closing a closed socket says nothing.
    socket?.close();
    ticket?.settle(false);
    ticket?.close();
  };
  input.admission.admit(input.environmentId, turn.signal).then(
    (admitted) => {
      admitted.claim();
      if (ended) return admitted.settle(false);
      ticket = admitted;
      // Told to give way before this ran: no listener would hear of it.
      if (admitted.signal.aborted) return end();
      let dialed: WebSocketLike;
      try {
        dialed = input.dial(input.socketUrl);
      } catch {
        return end();
      }
      socket = dialed;
      // The turn is the handshake's: over once the socket is open.
      dialed.addEventListener("open", () => admitted.settle(true), { once: true });
      // Told to give way, or closed, before its ticket came: the attempt opens its own in turn.
      const lost = () => {
        if (!taken) end();
      };
      admitted.signal.addEventListener("abort", lost, { once: true });
      dialed.addEventListener("close", lost, { once: true });
    },
    // Let go of while it waited its turn.
    () => undefined,
  );
  return {
    socketUrl: input.socketUrl,
    /**
     * The socket and its turn, for a ticket that names exactly its address and came in time; else
     * null, the socket closed and its turn given back.
     */
    take: (
      socketUrl: string,
      now: number,
    ): { readonly socket: WebSocketLike; readonly ticket: AdmissionTicket } | null => {
      const held = { socket, ticket };
      if (
        ended ||
        held.socket === null ||
        held.ticket === null ||
        socketUrl !== input.socketUrl ||
        now - input.dialedAt >= SOCKET_AHEAD_MS ||
        (held.socket.readyState !== SOCKET_CONNECTING && held.socket.readyState !== SOCKET_OPEN)
      ) {
        end();
        return null;
      }
      taken = true;
      return { socket: held.socket, ticket: held.ticket };
    },
    end,
  };
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const resolver = yield* ConnectionResolver.ConnectionResolver;
  const sessions = yield* RpcSession.RpcSessionFactory;

  /** Mates whose ticket named another address than they are registered at: none is dialed again. */
  const elsewhere = new Set<EnvironmentId>();

  /**
   * Dials the route's Mate's socket now, where its address is known before its ticket; for any
   * other environment, nothing: its socket waits its turn after its ticket, as before.
   */
  const startAhead = Effect.fnUntraced(function* (
    entry: ConnectionCatalogEntry,
    admission: ConnectionAdmission,
  ) {
    const environmentId = entry.target.environmentId;
    const dial = sessions.dial;
    const socketUrl = resolver.socketUrlAhead?.(entry) ?? null;
    if (
      dial === undefined ||
      socketUrl === null ||
      elsewhere.has(environmentId) ||
      admission.preferred() !== environmentId
    ) {
      return null;
    }
    const dialedAt = yield* Clock.currentTimeMillis;
    // Dialed and given its end in one step no interruption splits.
    return yield* Effect.acquireRelease(
      Effect.sync(() => dialAhead({ admission, environmentId, socketUrl, dial, dialedAt })),
      (ahead) => Effect.sync(ahead.end),
    );
  });

  const connect = Effect.fn("ConnectionDriver.connect")(function* (
    entry: ConnectionCatalogEntry,
    reportProgress: (progress: ConnectionDriverProgress) => Effect.Effect<void>,
    queue: (waiting: boolean) => Effect.Effect<void> = () => Effect.void,
    options?: { readonly ahead?: boolean },
  ) {
    const target = entry.target;
    yield* Effect.annotateCurrentSpan({
      "connection.environment.id": target.environmentId,
      "connection.target.kind": target._tag,
    });
    yield* reportProgress({ stage: "preparing" });
    const admission = yield* ConnectionAdmissionRef;
    const ahead = options?.ahead === true ? yield* startAhead(entry, admission) : null;
    const prepared = yield* resolver.prepare(entry);
    yield* reportProgress({ stage: "opening", prepared });
    // The socket waits its turn for the browser's one CONNECTING slot (`admission.ts`), and holds
    // it only until it opens: synchronizing runs outside. Acquired and released in one region no
    // interruption splits, so a ticket is never left holding the others.
    const session = yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // The socket dialed ahead and its turn; or, closed and its turn given back, none.
        const dialed = ahead?.take(prepared.socketUrl, yield* Clock.currentTimeMillis) ?? null;
        if (ahead !== null && prepared.socketUrl !== ahead.socketUrl) {
          elsewhere.add(target.environmentId);
        }
        let ticket: AdmissionTicket;
        if (dialed !== null) {
          ticket = dialed.ticket;
        } else {
          yield* queue(true);
          ticket = yield* restore(
            Effect.promise((signal) => admission.admit(target.environmentId, signal)),
          ).pipe(Effect.ensuring(queue(false)));
          ticket.claim();
          yield* Effect.addFinalizer(() => Effect.sync(ticket.close));
        }
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
          const opened = yield* sessions.connect(prepared, dialed?.socket);
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
    if (target._tag === "ZeropsMateConnectionTarget") {
      // Tickets skip the descriptor request; the admitted socket carries the same capabilities.
      const { capabilities } = (yield* session.initialConfig).environment;
      return {
        prepared: {
          ...prepared,
          contentAddressedImages: capabilities.contentAddressedImages === true,
          ...(capabilities.mateEngine === undefined
            ? {}
            : { mateEngine: capabilities.mateEngine.protocol }),
        },
        session,
      } satisfies EnvironmentConnectionLease;
    }
    return { prepared, session } satisfies EnvironmentConnectionLease;
  });

  return ConnectionDriver.of({ connect });
});

export const layer = Layer.effect(ConnectionDriver, make);
