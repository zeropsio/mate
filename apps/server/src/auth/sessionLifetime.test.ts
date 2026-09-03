import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { AuthSessionId } from "@t3tools/contracts";

import type { SessionCredentialChange } from "./SessionStore.ts";
import { awaitSessionEnd, type SessionEndReason } from "./sessionLifetime.ts";

const SESSION_ID = AuthSessionId.make("session-under-test");
const OTHER_SESSION_ID = AuthSessionId.make("someone-elses-session");

const watch = Effect.fn("watchSessionEnd")(function* (input: {
  readonly expiresAt: DateTime.DateTime | undefined;
  readonly changes: Stream.Stream<SessionCredentialChange>;
}) {
  const outcome = yield* Ref.make(Option.none<SessionEndReason>());
  yield* Effect.forkChild(
    awaitSessionEnd({
      sessionId: SESSION_ID,
      expiresAt: input.expiresAt,
      changes: input.changes,
    }).pipe(Effect.flatMap((reason) => Ref.set(outcome, Option.some(reason)))),
  );
  yield* Effect.yieldNow;
  return outcome;
});

describe("awaitSessionEnd", () => {
  it.effect("reports the deadline once the session's own lifetime elapses", () =>
    Effect.gen(function* () {
      // The Zerops membership window is only a real bound if the connection
      // that outlives it is ended. Enforced at upgrade alone, a tab that stays
      // connected is never re-checked again at all.
      const outcome = yield* watch({
        expiresAt: DateTime.makeUnsafe(900_000),
        changes: Stream.never,
      });

      yield* TestClock.adjust("14 minutes");
      expect(Option.isNone(yield* Ref.get(outcome))).toBe(true);

      yield* TestClock.adjust("2 minutes");
      expect(yield* Ref.get(outcome)).toStrictEqual(Option.some("expired"));
    }),
  );

  it.effect("reports a revocation that lands while the session is still young", () =>
    Effect.gen(function* () {
      // `revokeBySubject` ends a Zerops user's access on every device. Without
      // this the DB row flips and an open socket keeps its scopes regardless.
      const outcome = yield* watch({
        expiresAt: DateTime.makeUnsafe(4_000_000_000_000),
        changes: Stream.succeed<SessionCredentialChange>({
          type: "clientRemoved",
          sessionId: SESSION_ID,
        }),
      });
      expect(yield* Ref.get(outcome)).toStrictEqual(Option.some("revoked"));
    }),
  );

  it.effect("ignores a revocation aimed at a different session", () =>
    Effect.gen(function* () {
      const outcome = yield* watch({
        expiresAt: DateTime.makeUnsafe(900_000),
        changes: Stream.succeed<SessionCredentialChange>({
          type: "clientRemoved",
          sessionId: OTHER_SESSION_ID,
        }),
      });
      yield* TestClock.adjust("1 minute");
      expect(Option.isNone(yield* Ref.get(outcome))).toBe(true);
    }),
  );

  it.effect("waits indefinitely for a session that carries no deadline", () =>
    Effect.gen(function* () {
      // A pairing session with no stored expiry must not be closed on a guess.
      const outcome = yield* watch({ expiresAt: undefined, changes: Stream.never });
      yield* TestClock.adjust("30 days");
      expect(Option.isNone(yield* Ref.get(outcome))).toBe(true);
    }),
  );
});
