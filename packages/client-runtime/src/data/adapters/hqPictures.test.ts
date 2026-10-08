import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Clock from "effect/Clock";
import { AtomRegistry } from "effect/reactivity";

import { hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { makeHqPictureReads } from "./hqPictures.ts";
import { pictureId, pictureOwner, pictureScope } from "../families/hqPicture.ts";
import { linkKeys } from "../model.ts";
import { hqPicture } from "../projections/hqPicture.ts";
import { streamOf } from "../reducer.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigationLink, type HqWire } from "./hq.ts";

const key = { orgId: "org", link: { appId: "app", repo: "repo", number: 1, id: "picture" } };
const scope = pictureScope(key);
const demand = { family: "hqPicture", ownerId: pictureOwner(key.link) } as const;
const blob = new Blob(["picture"], { type: "image/png" });
const until = (store: AccountStore, ready: () => boolean) =>
  Effect.callback<void>((resume) => {
    const check = () => {
      if (ready()) resume(Effect.void);
    };
    const stop = store.subscribe(check);
    check();
    return Effect.sync(stop);
  }).pipe(Effect.timeout("2 seconds"));

describe("HQ picture demand on the account link", () => {
  it.live.each([
    { name: "accepted bytes", refused: false },
    { name: "definitive refusal", refused: true },
  ])("$name stays shared across remount and segment rotation", ({ refused }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const opened = yield* Deferred.make<void>();
      const rotated = yield* Deferred.make<void>();
      let reads = 0;
      const wire: HqWire = {
        open: fixture.wire.open.pipe(
          Effect.tap(() => Deferred.succeed(fixture.opens() === 2 ? rotated : opened, undefined)),
        ),
        picture: () =>
          Effect.suspend(() => {
            reads += 1;
            return refused
              ? Effect.fail({ outcome: "definitive-refusal" as const, message: "No picture." })
              : Effect.succeed(blob);
          }),
      };
      const link = hqNavigationLink({ orgId: key.orgId, store, wire });
      const release = link.demandDetail(demand);
      const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
      yield* Effect.forkScoped(supervisor.run);
      yield* Deferred.await(opened);
      yield* fixture.send({ type: "ping" });

      yield* until(
        store,
        () => streamOf(store.state(), scope).phase === (refused ? "refused" : "live"),
      );
      expect(reads).toBe(1);
      const result = hqPicture.derive(readsOfState(store.state()), key);
      expect(result.kind).toBe(refused ? "failed" : "read");
      release();
      const again = link.demandDetail(demand);
      yield* until(store, () => streamOf(store.state(), linkKeys.hq(key.orgId)).phase === "live");
      expect(reads).toBe(1);
      expect(fixture.opens()).toBe(1);
      yield* fixture.endSegment;
      yield* Deferred.await(rotated).pipe(Effect.timeout("2 seconds"));
      yield* fixture.send({ type: "ping" });
      expect(fixture.opens()).toBe(2);
      expect(reads).toBe(1);
      if (refused) {
        yield* supervisor.signal("manual-retry");
        yield* until(
          store,
          () => reads === 2 && streamOf(store.state(), scope).phase === "refused",
        );
      } else
        expect(store.state().facts.get(`hqPicture:${pictureId(key)}`)?.content.kind).toBe("value");
      again();
      link.stop();
    }).pipe(Effect.scoped),
  );
});

describe("HQ picture registration fencing", () => {
  it.live.each(["release", "deadline", "refusal"] as const)(
    "ignores an answer after %s",
    (ending) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const bytes = yield* Deferred.make<Blob>();
        const started = yield* Deferred.make<void>();
        const finished = yield* Deferred.make<void>();
        const signal = (event: Parameters<Parameters<typeof makeHqPictureReads>[0]["signal"]>[1]) =>
          Effect.map(Clock.currentTimeMillis, (now) =>
            store.dispatch({ kind: "stream", key: scope, now, event }),
          );
        yield* signal({ kind: "demand", demanded: true });
        const observe = yield* makeHqPictureReads({
          orgId: key.orgId,
          store,
          signal: (_scope, event) => signal(event),
          read: () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(bytes))),
          wake: () => {
            Deferred.doneUnsafe(finished, Effect.void);
          },
        });
        yield* observe([scope]);
        yield* Deferred.await(started);
        yield* signal(
          ending === "release"
            ? { kind: "demand", demanded: false }
            : ending === "deadline"
              ? { kind: "deadline" }
              : {
                  kind: "fault",
                  jitter: 0,
                  fault: { outcome: "definitive-refusal", message: "No picture." },
                },
        );
        yield* Deferred.succeed(bytes, blob);
        yield* Deferred.await(finished);
        expect(hqPicture.derive(readsOfState(store.state()), key).kind).not.toBe("read");
        expect(store.state().facts.size).toBe(0);
      }).pipe(Effect.scoped),
  );
});
