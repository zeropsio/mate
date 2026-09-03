import type { AuthSessionId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { SessionCredentialChange } from "./SessionStore.ts";

export type SessionEndReason = "expired" | "revoked";

/**
 * Completes when the session behind a live connection stops being valid.
 *
 * Both halves exist because the session is only ever checked at the door:
 * `authenticateWebSocketUpgrade` verifies it once, and the scopes captured
 * there are never re-read for the life of the socket. That makes the Zerops
 * membership window (900s by default) a bound on the NEXT connect only — the
 * continuously connected client, which is exactly who the guarantee is about,
 * was never re-checked at all. Revocation had the same hole: `revoke` and
 * `revokeBySubject` flip a database row and publish a UI event, and nothing
 * consumed it to end the matching connection.
 *
 * A session with no stored deadline is left alone rather than closed on a
 * guess; a pairing session legitimately has none.
 */
export const awaitSessionEnd = Effect.fn("auth.awaitSessionEnd")(function* (input: {
  readonly sessionId: AuthSessionId;
  readonly expiresAt: DateTime.DateTime | undefined;
  readonly changes: Stream.Stream<SessionCredentialChange>;
}): Effect.fn.Return<SessionEndReason> {
  const expiresAt = input.expiresAt;
  const revoked = input.changes.pipe(
    Stream.filter(
      (change) => change.type === "clientRemoved" && change.sessionId === input.sessionId,
    ),
    Stream.runHead,
    // A changes stream that simply ENDS is not a revocation. Treating the empty
    // result as one would close every socket the moment the feed completed.
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.never,
        onSome: () => Effect.succeed<SessionEndReason>("revoked"),
      }),
    ),
  );
  if (expiresAt === undefined) {
    return yield* revoked;
  }
  const expired = Effect.gen(function* () {
    const remainingMs = expiresAt.epochMilliseconds - (yield* Clock.currentTimeMillis);
    if (remainingMs > 0) {
      yield* Effect.sleep(remainingMs);
    }
    return "expired" as const;
  });
  return yield* Effect.raceFirst(revoked, expired);
});
