import { assert, describe, it } from "@effect/vitest";
import { HqAttentionValue } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import { rowsWhere } from "../test/harness/mates.ts";
import { digest, mainAt, memoryStore, overviewOf } from "../test/harness/overviews.ts";
import {
  enrollMate,
  sessionFor,
  setUpMate,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { makeMateOverviews } from "./mateOverviews.ts";

/** What `saves` holds once the store's worker, which runs beside the link, has had its turns. */
const readAttention = Schema.decodeEffect(HqAttentionValue);
it.effect("forget cleans retained result acknowledgements even without an overview", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const forgotten: string[] = [];
      const { store } = memoryStore();
      const overviews = yield* makeMateOverviews({
        ...store,
        forgetSeen: (ids) =>
          Effect.sync(() => {
            forgotten.push(...ids);
          }),
      });
      yield* overviews.forget(["P"]);
      assert.deepStrictEqual(forgotten, ["P"]);
    }),
  ),
);

const settled = (saves: ReadonlyArray<string>) =>
  Effect.map(Effect.repeat(Effect.yieldNow, { times: 100 }), () => [...saves]);

describe("MateOverviews", () => {
  it.effect("replaces only the sections a frame names", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const overviews = yield* makeMateOverviews(memoryStore().store);
        const link = yield* overviews.connect("P");
        const whole = overviewOf({ main: mainAt("Read the schema") });
        yield* overviews.report("P", link, { type: "overview", full: true, overview: whole });
        yield* overviews.report("P", link, {
          type: "overview",
          full: false,
          sections: { main: mainAt("Write the migration") },
        });
        const entry = (yield* overviews.all).get("P");
        assert.deepStrictEqual(entry?.overview, { ...whole, main: mainAt("Write the migration") });
        assert.deepStrictEqual([entry?.presence.online, entry?.presence.overview], [true, "live"]);
      }),
    ),
  );

  it.effect("takes frames from the newest link and passes by an older one's", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const overviews = yield* makeMateOverviews(memoryStore().store);
        const older = yield* overviews.connect("P");
        yield* overviews.report("P", older, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        // A restarted server's new link, while HQ has not yet heard the old one go.
        const newer = yield* overviews.connect("P");
        const fresh = overviewOf({ threads: { list: [digest("t2")], omitted: 0 } });
        // Its sections before its whole overview say nothing yet.
        yield* overviews.report("P", newer, {
          type: "overview",
          full: false,
          sections: { main: mainAt("Too early") },
        });
        yield* overviews.report("P", newer, { type: "overview", full: true, overview: fresh });
        yield* overviews.report("P", older, {
          type: "overview",
          full: false,
          sections: { main: mainAt("From the old server") },
        });
        assert.deepStrictEqual((yield* overviews.all).get("P")?.overview, fresh);
      }),
    ),
  );

  // F26: the Zerops L7 cuts every link at 120 s, so a Mate opens its successor before the cut and
  // lets the old link go once HQ answered on the new one. The Mate never goes offline meanwhile.
  it.effect(
    "keeps a Mate online across a rotation: its successor opens before the old link goes",
    () =>
      Effect.gen(function* () {
        const { saves, store } = memoryStore();
        const overviews = yield* makeMateOverviews(store);
        const scope = yield* Scope.make();
        const older = yield* overviews.connect("P").pipe(Scope.provide(scope));
        yield* overviews.report("P", older, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        const before = (yield* overviews.all).get("P")?.presence;

        const successor = yield* overviews.connect("P");
        yield* overviews.report("P", successor, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Scope.close(scope, Exit.void);

        const after = (yield* overviews.all).get("P")?.presence;
        assert.deepStrictEqual(after, before);
        assert.isTrue(after?.online);
        // The two whole overviews are written; the old link's going writes nothing of its own.
        assert.deepStrictEqual(yield* settled(saves), ["P", "P"]);
      }).pipe(Effect.scoped),
  );

  it.effect("writes when a thread's kind changes, not when its live step does", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { saves, store } = memoryStore();
        const overviews = yield* makeMateOverviews(store);
        const link = yield* overviews.connect("P");
        // A whole overview is written: what a reconnect brings is the Mate as it stands.
        yield* overviews.report("P", link, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        assert.deepStrictEqual(yield* settled(saves), ["P"]);
        for (const step of ["Read the schema", "Write the migration", "Run the tests"]) {
          yield* overviews.report("P", link, {
            type: "overview",
            full: false,
            sections: { main: mainAt(step) },
          });
        }
        assert.deepStrictEqual(yield* settled(saves), ["P"]);
        yield* overviews.report("P", link, {
          type: "overview",
          full: false,
          sections: { threads: { list: [digest("t1", "working")], omitted: 0 } },
        });
        assert.deepStrictEqual(yield* settled(saves), ["P", "P"]);
        // The same kinds again, the list reordered by a newer chat: nothing that rests moved.
        yield* overviews.report("P", link, {
          type: "overview",
          full: false,
          sections: { threads: { list: [digest("t1", "working")], omitted: 1 } },
        });
        assert.deepStrictEqual(yield* settled(saves), ["P", "P"]);
      }),
    ),
  );

  it.effect(
    "writes the overview when the last link goes and reads it back as stored after a restart",
    () =>
      Effect.gen(function* () {
        const { rows, store } = memoryStore();
        const last = overviewOf({ main: mainAt("Run the tests") });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const overviews = yield* makeMateOverviews(store);
            const link = yield* Effect.scoped(
              Effect.gen(function* () {
                const link = yield* overviews.connect("P");
                yield* overviews.report("P", link, {
                  type: "overview",
                  full: true,
                  overview: overviewOf(),
                });
                yield* overviews.report("P", link, {
                  type: "overview",
                  full: false,
                  sections: { main: last.main },
                });
                assert.strictEqual(
                  (yield* overviews.all).get("P")?.presence.since,
                  "1970-01-01T00:00:00.000Z",
                );
                // An hour on, the Mate sleeps.
                yield* TestClock.adjust("1 hour");
                return link;
              }),
            );
            assert.isNumber(link);
            // Gone with its last link: offline since then, its last overview kept, and written.
            const entry = (yield* overviews.all).get("P");
            assert.deepStrictEqual(entry?.presence, {
              online: false,
              since: "1970-01-01T01:00:00.000Z",
              overview: "stored",
            });
            yield* settled([]);
          }),
        );
        assert.deepStrictEqual(rows.get("P")?.overview, last);

        // The next Core holds no link of it: what the store kept stands, offline, as of its writing.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const overviews = yield* makeMateOverviews(store);
            yield* overviews.restore;
            const entry = (yield* overviews.all).get("P");
            assert.deepStrictEqual(entry, {
              attention: null,
              attentionState: "none",
              presence: { online: false, since: rows.get("P")!.reportedAt, overview: "stored" },
              overview: last,
            });
          }),
        );
      }),
  );

  it.effect("forgets a Mate whose record goes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rows, store } = memoryStore([
          { projectId: "GONE", overview: overviewOf(), reportedAt: "2026-10-03T09:00:00.000Z" },
        ]);
        const overviews = yield* makeMateOverviews(store);
        yield* overviews.restore;
        const link = yield* overviews.connect("KEPT");
        yield* overviews.report("KEPT", link, {
          type: "overview",
          full: true,
          overview: overviewOf(),
        });
        yield* overviews.forget(["GONE"]);
        assert.deepStrictEqual([...(yield* overviews.all).keys()], ["KEPT"]);
        // Its row goes with its record (a foreign key), not by this.
        assert.isTrue(rows.has("GONE"));
      }),
    ),
  );
});

/** A Core with the Mate `P_MATE` enrolled and linked, its overview sent. */
const linkedCore = (url?: string) =>
  Effect.gen(function* () {
    const core = yield* startCore(true, url === undefined ? {} : { url });
    yield* untilHealth(core.call, "active");
    const owner = yield* setUpMate(core.call, "P_MATE");
    const credential = yield* enrollMate(core.call, core.fake, "P_MATE");
    const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
      headers: { authorization: `Mate ${credential}` },
    })).body as { readonly ticket: string };
    const link = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
    yield* link.next("state");
    return { ...core, owner, link };
  });

it.effect("attention keeps source order and becomes live again on an unchanged new link", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const overviews = yield* makeMateOverviews(memoryStore().store);
      const value = {
        source: { environmentId: "env", epoch: 1, incarnation: "boot", revision: 2 },
        mainThreadId: "main",
        lastThreadId: "last",
        working: 0,
        waiting: 0,
        results: [],
        questions: [],
        truncated: false,
      };
      const first = yield* overviews.connect("P");
      yield* overviews.reportAttention("P", first, value);
      assert.strictEqual((yield* overviews.all).get("P")?.attentionState, "live");
      const second = yield* overviews.connect("P");
      assert.strictEqual((yield* overviews.all).get("P")?.attentionState, "stored");
      yield* overviews.reportAttention("P", second, { ...value, results: null });
      assert.strictEqual((yield* overviews.all).get("P")?.attentionState, "stored");
      yield* overviews.reportAttention("P", second, value);
      assert.strictEqual((yield* overviews.all).get("P")?.attentionState, "live");
      yield* overviews.reportAttention("P", first, {
        ...value,
        source: { ...value.source, revision: 9 },
      });
      yield* overviews.reportAttention("P", second, {
        ...value,
        source: { ...value.source, revision: 1 },
      });
      yield* overviews.reportAttention("P", second, {
        ...value,
        source: { ...value.source, incarnation: "old" },
      });
      assert.deepStrictEqual(
        (yield* overviews.all).get("P")?.attention,
        yield* readAttention(value),
      );
    }),
  ),
);

it.effect("attention of an earlier run never replaces a later run's, from its newer link", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const overviews = yield* makeMateOverviews(memoryStore().store);
      const later = {
        source: { environmentId: "env", epoch: 2, incarnation: "later", revision: 0 },
        mainThreadId: "main",
        lastThreadId: "main",
        working: 0,
        waiting: 0,
        results: [],
        questions: [],
        truncated: false,
      };
      yield* overviews.reportAttention("P", yield* overviews.connect("P"), later);
      // The run before comes back from a partition, on a link newer than the later run's.
      const partitioned = yield* overviews.connect("P");
      yield* overviews.reportAttention("P", partitioned, {
        ...later,
        source: { ...later.source, epoch: 1, incarnation: "before", revision: 9 },
        working: 3,
      });
      const held = (yield* overviews.all).get("P");
      assert.deepStrictEqual(
        { attention: held?.attention, state: held?.attentionState },
        // The later run's word stays, live: HQ hears the later run's link, not the run before's.
        { attention: yield* readAttention(later), state: "live" },
      );
    }),
  ),
);

it.effect(
  "the run before reconnects after a restart: its reports lose, the restarted run's hold",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const overviews = yield* makeMateOverviews(memoryStore().store);
        const run = (epoch: number, incarnation: string, revision: number, working: number) => ({
          source: { environmentId: "env", epoch, incarnation, revision },
          mainThreadId: "main",
          lastThreadId: "main",
          working,
          waiting: 0,
          results: [],
          questions: [],
          truncated: false,
        });
        const before = yield* overviews.connect("P");
        yield* overviews.reportAttention("P", before, run(1, "before", 4, 1));
        // A hard kill HQ has not heard yet: the restarted run's link opens beside the old one.
        const restarted = yield* overviews.connect("P");
        yield* overviews.reportAttention("P", restarted, run(2, "after", 0, 0));
        yield* overviews.report("P", restarted, {
          type: "overview",
          full: true,
          overview: overviewOf({ main: mainAt("Restarted") }),
        });
        // The run before comes back on a link newer than both.
        const back = yield* overviews.connect("P");
        yield* overviews.reportAttention("P", back, run(1, "before", 9, 3));
        yield* overviews.report("P", back, {
          type: "overview",
          full: true,
          overview: overviewOf({ main: mainAt("Run before") }),
        });
        yield* overviews.reportAttention("P", before, run(1, "before", 10, 3));
        // The restarted run goes on, on its own link.
        yield* overviews.reportAttention("P", restarted, run(2, "after", 1, 2));
        yield* overviews.report("P", restarted, {
          type: "overview",
          full: false,
          sections: { main: mainAt("Restarted, later") },
        });
        const held = (yield* overviews.all).get("P");
        assert.deepStrictEqual(
          {
            attention: held?.attention,
            state: held?.attentionState,
            main: held?.overview?.main,
            overview: held?.presence.overview,
          },
          {
            attention: yield* readAttention(run(2, "after", 1, 2)),
            state: "live",
            main: mainAt("Restarted, later"),
            overview: "live",
          },
        );
      }),
    ),
);

describe("MateOverviews in HQ's store", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("keeps a slept Mate's overview across a restart of its Core", () =>
      Effect.gen(function* () {
        const first = yield* linkedCore();
        const overview = overviewOf({ main: mainAt("Run the tests") });
        yield* first.link.send({ type: "overview", full: true, overview });
        // The Mate sleeps: its link goes, and its overview is kept.
        yield* first.link.close;
        yield* rowsWhere(
          first.url,
          "SELECT project_id FROM hq_mate_overview",
          (rows) => rows.length === 1,
        );
        yield* first.stop;

        const next = yield* startCore(true, { url: first.url });
        yield* untilHealth(next.call, "active");
        // The first Core spent the owner's first throwaway; a throwaway is good once.
        const owner = yield* sessionFor(next.call, "door-owner-2");
        const stream = yield* next.socket(
          `/api/structure/ws?ticket=${yield* ticketFor(next.call, owner)}`,
        );
        yield* stream.send({
          type: "subscribe",
          scopes: [{ scope: { kind: "attention", projectId: "P_MATE" } }],
        });
        const { values } = (yield* stream.next("scope-reset")) as {
          readonly values: ReadonlyArray<{
            readonly key: string;
            readonly value: {
              readonly presence: { readonly overview: string };
              readonly overview: unknown;
            };
          }>;
        };
        const mate = values.find((entry) => entry.key === "P_MATE")?.value;
        assert.deepStrictEqual(
          { overview: mate?.overview, presence: mate?.presence.overview },
          { overview, presence: "stored" },
        );
      }),
    );

    it.effect("lets a Mate's overview go with its project", () =>
      Effect.gen(function* () {
        const { fake, link, overviews, url } = yield* linkedCore();
        yield* link.send({ type: "overview", full: true, overview: overviewOf() });
        yield* link.close;
        yield* rowsWhere(
          url,
          "SELECT project_id FROM hq_mate_overview",
          (rows) => rows.length === 1,
        );
        // The project goes from Zerops: its record goes on the next reconcile, and its overview.
        fake.projects.splice(
          fake.projects.findIndex((project) => project.id === "P_MATE"),
          1,
        );
        yield* rowsWhere(
          url,
          "SELECT project_id FROM hq_mate_overview",
          (rows) => rows.length === 0,
        );
        const held = yield* overviews.all.pipe(
          Effect.filterOrFail((all) => !all.has("P_MATE")),
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(5)),
        );
        assert.isFalse(held.has("P_MATE"));
      }),
    );
  });
});
