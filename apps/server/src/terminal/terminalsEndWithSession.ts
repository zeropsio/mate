/**
 * A terminal ends with the session that opened it.
 *
 * Stored-session revocations close their terminals. In Zerops mode the socket's
 * finalizer closes the terminals owned by its live connection instead.
 *
 * @module terminalsEndWithSession
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { SessionStore } from "../auth/SessionStore.ts";
import { TerminalManager } from "./Manager.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const held = yield* Effect.serviceOption(SessionStore);
    if (Option.isNone(held)) return;
    const sessions = held.value;
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
