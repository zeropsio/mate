import { assert, describe, it } from "@effect/vitest";
import type { KeyLinkAccess } from "@t3tools/shared/mateLink";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  ACCESS_LIST_HOLDS,
  type AccessList,
  make as makeAccessList,
  nextAccessList,
} from "./ZeropsMateAccessList.ts";

const AT = "2026-10-24T10:00:00.000Z";
const JAN = { userId: "jan", role: "OWNER", visibility: "open" } as const;
const EVA = { userId: "eva", role: "READ_ONLY", visibility: "listed" } as const;

const full = (version: number, members: KeyLinkAccess["members"]): KeyLinkAccess => ({
  type: "access",
  version,
  viewAt: AT,
  full: true,
  members,
});
const delta = (version: number, members: KeyLinkAccess["members"]): KeyLinkAccess => ({
  type: "access",
  version,
  viewAt: AT,
  full: false,
  members,
});

/** Who a list names, by user and visibility; `none` before any list. */
const named = (list: AccessList | undefined) =>
  list === undefined
    ? "none"
    : list.members.map((member) => `${member.userId}:${member.visibility}`).join(",");

describe("nextAccessList", () => {
  it.each<[string, ReadonlyArray<KeyLinkAccess>, string]>([
    ["a delta before any snapshot is discarded", [delta(5, [JAN])], "none"],
    ["a snapshot is the baseline", [full(3, [JAN, EVA])], "jan:open,eva:listed"],
    [
      "a snapshot numbered below the last still replaces it",
      [full(9, [JAN, EVA]), full(1, [EVA])],
      "eva:listed",
    ],
    [
      "a delta above the last applies its entries",
      [full(3, [JAN]), delta(4, [EVA, { ...JAN, role: "READ_ONLY", visibility: "listed" }])],
      "jan:listed,eva:listed",
    ],
    [
      "a delta entry with visibility none removes its member",
      [full(3, [JAN, EVA]), delta(4, [{ ...EVA, visibility: "none" }])],
      "jan:open",
    ],
    [
      "a delta at the last version is discarded",
      [full(3, [JAN]), delta(3, [{ ...JAN, visibility: "none" }])],
      "jan:open",
    ],
    [
      "a delta below the last is discarded",
      [full(3, [JAN]), delta(4, [EVA]), delta(2, [{ ...JAN, visibility: "none" }])],
      "jan:open,eva:listed",
    ],
  ])(
    "A full access frame resets the Mate's baseline whatever its version; only deltas are compared by version: %s",
    (_name, frames, expected) => {
      const list = frames.reduce<AccessList | undefined>(
        (held, frame) => nextAccessList(held, frame, 0),
        undefined,
      );
      assert.strictEqual(named(list), expected);
    },
  );
});

describe("ZeropsMateAccessList", () => {
  it.effect("TC-13 a view within 60 seconds of the Mate clock caps the hold from receipt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(AT));
      const list = yield* makeAccessList;
      yield* list.heard({ ...full(1, [JAN]), viewAt: "2026-10-24T09:59:00.000Z" });
      yield* TestClock.adjust("14 minutes");
      assert.isTrue(Option.isSome(yield* list.current));
      yield* TestClock.adjust(1);
      assert.isTrue(Option.isNone(yield* list.current));
    }),
  );

  it.effect("answers from HQ's relay while it is fresh, reading nothing of Zerops", () =>
    Effect.gen(function* () {
      // The list is built from nothing but the frames: no Zerops reader, no key.
      const list = yield* makeAccessList;
      assert.isTrue(Option.isNone(yield* list.current));
      yield* list.heard(full(1, [JAN, EVA]));
      yield* TestClock.adjust(Duration.minutes(10));
      assert.strictEqual(named(Option.getOrUndefined(yield* list.current)), "jan:open,eva:listed");
    }),
  );

  it.effect(
    "holds the latest list for 15 minutes from the frame that brought it, and answers nothing past that",
    () =>
      Effect.gen(function* () {
        const list = yield* makeAccessList;
        yield* list.heard(full(1, [JAN]));
        yield* TestClock.adjust(Duration.minutes(10));
        // HQ's next view changed nothing: its empty delta still renews the list.
        yield* list.heard(delta(2, []));
        // A discarded delta renews nothing.
        yield* list.heard(delta(2, []));
        yield* TestClock.adjust(ACCESS_LIST_HOLDS);
        assert.strictEqual(named(Option.getOrUndefined(yield* list.current)), "jan:open");
        yield* TestClock.adjust(Duration.millis(1));
        assert.isTrue(Option.isNone(yield* list.current));
      }),
  );

  it.effect("tells a relay that changed who it lets in, never one that only aged", () =>
    Effect.gen(function* () {
      const list = yield* makeAccessList;
      const told = yield* Stream.runCollect(Stream.take(list.changes, 4)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* list.heard(full(1, [JAN]));
      yield* list.heard(delta(2, []));
      yield* list.heard(full(3, [JAN]));
      yield* list.heard(delta(4, [EVA]));
      yield* list.heard(delta(4, [{ ...EVA, visibility: "none" }]));
      yield* list.heard({ type: "access", version: 5, full: true, refused: true, members: [] });
      yield* Effect.repeat(Effect.yieldNow, { times: 10 });
      // Three changes so far: the first list, Eva listed, the refusal.
      assert.isUndefined(told.pollUnsafe());
      yield* list.heard(full(6, [JAN]));
      assert.lengthOf(yield* Fiber.join(told), 4);
    }),
  );
});
