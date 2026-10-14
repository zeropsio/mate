/**
 * A terminal ends with the session that opened it.
 *
 * A revoked session — its person removed or lowered by the membership re-check
 * (`ZeropsMembershipWatch`), signed out from another device — loses its sockets
 * through `awaitSessionEnd`, but the PTY it opened is not a socket: it ran on
 * with nobody able to reach it. Here every revocation closes the terminals that
 * session opened, by the process handle the manager holds, within the same
 * bound as every other channel.
 *
 * @module terminalsEndWithSession
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { SessionStore } from "../auth/SessionStore.ts";
import { TerminalManager } from "./Manager.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessions = yield* SessionStore;
    const terminals = yield* TerminalManager;
    yield* sessions.streamChanges.pipe(
      Stream.runForEach((change) =>
        change.type === "clientRemoved"
          ? terminals.closeOpenedBy(change.sessionId).pipe(
              Effect.tap((closed) =>
                closed > 0
                  ? Effect.logInfo("Closed the terminals a revoked session opened.", {
                      sessionId: change.sessionId,
                      closed,
                    })
                  : Effect.void,
              ),
            )
          : Effect.void,
      ),
      Effect.forkScoped,
    );
  }),
);
