import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import type { ChangeDetailResponse } from "@t3tools/shared/hqChanges";
import { hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { changeReadOwner, changeReadScope } from "../families/hqChangeRead.ts";
import { hqChangeRead } from "../projections/hqChangeRead.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { streamOf } from "../reducer.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigationLink, type HqWire } from "./hq.ts";

const DETAIL: ChangeDetailResponse = {
  change: {
    appId: "app",
    repo: "repo",
    number: 1,
    mateProjectId: "mate",
    title: "Change",
    body: "Review body",
    state: "open",
    head: "b".repeat(40),
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-10-01T00:00:00Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-10-01T00:00:00Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: 0,
  },
  mainHead: "a".repeat(40),
  mergeBase: "a".repeat(40),
  mergeability: { kind: "clean" },
  files: [],
  filesTruncated: false,
  commits: [],
  commitsTruncated: false,
};
const request = { link: { appId: "app", repo: "repo", number: 1 } };
const owner = changeReadOwner(request);
const key = { orgId: "org", owner };
const scope = changeReadScope(key.orgId, owner);
const until = (store: AccountStore, ready: () => boolean) =>
  Effect.callback<void>((resume) => {
    const check = () => {
      if (ready()) resume(Effect.void);
    };
    const stop = store.subscribe(check);
    check();
    return Effect.sync(stop);
  }).pipe(Effect.timeout("2 seconds"));

describe("HQ review read on the account's shared link", () => {
  it.live.each(["accepted", "refusal", "outage"] as const)(
    "%s retains its answer and obeys explicit retry",
    (answer) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = hqFixtureWire();
        const opened = yield* Deferred.make<void>();
        let reads = 0;
        let accepted = answer === "accepted";
        const wire: HqWire = {
          open: fixture.wire.open.pipe(Effect.tap(() => Deferred.succeed(opened, undefined))),
          change: () =>
            Effect.suspend(() => {
              reads += 1;
              return accepted
                ? Effect.succeed(DETAIL)
                : Effect.fail({
                    outcome:
                      answer === "refusal"
                        ? ("definitive-refusal" as const)
                        : ("transient" as const),
                    message: "HQ did not answer.",
                  });
            }),
        };
        const link = hqNavigationLink({ orgId: "org", store, wire });
        const release = link.demandDetail({ family: "hqChangeRead", ownerId: owner });
        const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
        yield* Effect.forkScoped(supervisor.run);
        yield* Deferred.await(opened);
        yield* fixture.send({ type: "ping" });
        yield* until(
          store,
          () =>
            streamOf(store.state(), scope).phase ===
            (accepted ? "live" : answer === "refusal" ? "refused" : "recovering"),
        );
        expect(hqChangeRead.derive(readsOfState(store.state()), key).kind).toBe(
          accepted ? "read" : answer === "refusal" ? "refused" : "unavailable",
        );
        expect(reads).toBe(1);
        if (!accepted) {
          release();
          const held = link.demandDetail({ family: "hqChangeRead", ownerId: owner });
          expect(reads).toBe(1);
          accepted = true;
          link.retryDetail({ family: "hqChangeRead", ownerId: owner });
          yield* until(
            store,
            () => hqChangeRead.derive(readsOfState(store.state()), key).kind === "read",
          );
          expect(reads).toBe(2);
          held();
        } else {
          store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } });
          expect(hqChangeRead.derive(readsOfState(store.state()), key)).toEqual({
            kind: "read",
            detail: DETAIL,
          });
          release();
        }
        link.stop();
      }).pipe(Effect.scoped),
  );
  it("does not invent an empty review from partial coverage", () => {
    const store = makeAccountStore(AtomRegistry.make());
    store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
    expect(hqChangeRead.derive(readsOfState(store.state()), key)).toEqual({ kind: "reading" });
  });
});
