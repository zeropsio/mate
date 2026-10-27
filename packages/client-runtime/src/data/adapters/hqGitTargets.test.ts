import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { observeAccount } from "../account.ts";
import { fixtureWire, settle } from "../__fixtures__/zeropsWire.ts";
import {
  gitAdoption,
  gitEnvironment,
  gitPreflight,
  gitRemote,
  hqFixtureWire,
} from "../__fixtures__/hqWire.ts";
import { hqAppGitTargets, hqNavigation } from "../projections/hqNavigation.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { decodeHqGitTarget, isHqGitTargetKey } from "./hqGitTargets.ts";

describe("Git target detail decoding", () => {
  it.each([
    {
      key: "probe:web",
      raw: { ok: true, remote: gitRemote },
      value: { kind: "probe", repo: "web", value: { ok: true, remote: gitRemote } },
    },
    {
      key: "preflight:web",
      raw: gitPreflight,
      value: { kind: "preflight", repo: "web", value: gitPreflight },
    },
    {
      key: "adoption:web",
      raw: gitAdoption,
      value: { kind: "adoption", repo: "web", value: gitAdoption },
    },
    {
      key: "delivery",
      raw: { jobs: [], note: "web left out: no remote" },
      value: { kind: "delivery", value: { jobs: [], note: "web left out: no remote" } },
    },
  ])(
    "admits only proven $key facts without plaintext or inferred token ownership",
    ({ key, raw, value }) => {
      expect(
        decodeHqGitTarget(
          {
            ...raw,
            token: "PROTECTED_TOKEN_MARKER",
            seal: "PROTECTED_TOKEN_MARKER",
            tokenOwner: "github-owner",
          },
          key,
        ),
      ).toEqual(value);
    },
  );
  it.each([
    "probe:",
    "probe:../web",
    "preflight:web:main",
    "remote:web",
    "unknown",
    "adoption:main/branch",
  ])("does not invent an observation for unsupported key %s", (key) => {
    expect(isHqGitTargetKey(key)).toBe(false);
    expect(decodeHqGitTarget({}, key)).toBeNull();
  });
  it.each(["preflight", "adoption"])("rejects a mismatched repository in %s", (kind) => {
    expect(
      decodeHqGitTarget(kind === "preflight" ? gitPreflight : gitAdoption, `${kind}:api`),
    ).toBeNull();
  });
  it.each([429, 403])(
    "retains host wait evidence with status %s without invalidating custody",
    (status) => {
      const value = {
        ok: false,
        status,
        reason: "Host asked Mate to wait",
        retryAt: "2026-10-13T10:04:00Z",
      };
      expect(decodeHqGitTarget(value, "probe:web")).toEqual({ kind: "probe", repo: "web", value });
    },
  );
  it.each(["ready", "diverged", "credential", "declined", "unknown"])(
    "does not turn the source preflight verdict %s into ready",
    (verdict) => {
      const value = {
        ...gitPreflight,
        verdict,
        reason: verdict === "ready" ? null : "Review blocked",
      };
      expect(decodeHqGitTarget(value, "preflight:web")).toEqual({
        kind: "preflight",
        repo: "web",
        value,
      });
    },
  );
  it("keeps the exact attempted destination and hand-over without treating it as a running deployment", () => {
    const job = {
      ...gitEnvironment.jobs[0],
      environment: "Production",
      job: "push-v2",
      behind: null,
    };
    expect(decodeHqGitTarget({ jobs: [job], note: null }, "delivery")).toEqual({
      kind: "delivery",
      value: {
        jobs: [
          {
            environment: "Production",
            kind: "push",
            service: "web",
            sha: gitPreflight.sha,
            job: "push-v2",
            state: "pushed",
            processId: null,
            appVersionId: null,
            behind: null,
            reason: null,
            evidence: gitEnvironment.jobs[0].evidence,
          },
        ],
        note: null,
      },
    });
    expect(
      decodeHqGitTarget({ jobs: [{ ...job, state: "live" }], note: null }, "delivery"),
    ).toBeNull();
    expect(
      decodeHqGitTarget({ jobs: [{ ...job, sha: "c".repeat(40) }], note: null }, "delivery"),
    ).toBeNull();
  });
});

/** Resolve on the store's receipt; no clock or transport polling. */
const received = (store: AccountStore, predicate: () => boolean) =>
  Effect.callback<void>((resume) => {
    const check = () => {
      if (predicate()) resume(Effect.void);
    };
    const stop = store.subscribe(check);
    check();
    return Effect.sync(stop);
  }).pipe(Effect.timeout("3 seconds"), Effect.orDie);

it.live(
  "org switch and account close release Git demand and prevent late protected facts returning",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const wire = fixtureWire((request) =>
        Effect.succeed(request.body?.wsOutputType === "listStream" ? { items: [] } : {}),
      );
      const account = observeAccount({ store, wire: wire.wire, repairSession: Effect.void });
      const first = hqFixtureWire();
      const second = hqFixtureWire();
      const release = account.demandDetail({ family: "hqAppDetail", ownerId: "shop" });
      account.show("org-a");
      account.showHq({ orgId: "org-a", ownerId: "hq-a", wire: first.wire });
      yield* settle;
      expect(
        first.sent.some(
          ({ request }) =>
            request.type === "subscribe" &&
            request.scopes.some(({ scope }) => scope.kind === "app-detail"),
        ),
      ).toBe(true);
      const scope = { kind: "app-detail", appId: "shop" } as const;
      yield* first.send({
        type: "scope-reset",
        scope,
        incarnation: "a",
        revision: 1,
        values: [{ key: "preflight:web", value: gitPreflight }],
        removals: [],
      });
      yield* received(
        store,
        () =>
          hqAppGitTargets.derive(readsOfState(store.state()), { orgId: "org-a", appId: "shop" })
            .records["preflight:web"] !== undefined,
      );
      account.show("org-b");
      account.showHq({ orgId: "org-b", ownerId: "hq-b", wire: second.wire });
      yield* settle;
      expect(
        second.sent.some(
          ({ request }) =>
            request.type === "subscribe" &&
            request.scopes.some(({ scope }) => scope.kind === "app-detail"),
        ),
      ).toBe(true);
      expect(
        hqAppGitTargets.derive(readsOfState(store.state()), { orgId: "org-a", appId: "shop" })
          .records,
      ).toEqual({});
      yield* second.send({
        type: "scope-reset",
        scope,
        incarnation: "b",
        revision: 1,
        values: [{ key: "adoption:web", value: gitAdoption }],
        removals: [],
      });
      yield* received(
        store,
        () =>
          hqAppGitTargets.derive(readsOfState(store.state()), { orgId: "org-b", appId: "shop" })
            .records["adoption:web"] !== undefined,
      );
      account.close();
      expect(
        hqAppGitTargets.derive(readsOfState(store.state()), { orgId: "org-b", appId: "shop" })
          .records,
      ).toEqual({});
      expect(readsOfState(store.state()).stream(hqAppDetailScope("org-b", "shop")).demanded).toBe(
        false,
      );
      expect(
        hqNavigation.derive(readsOfState(store.state()), "org-b").deliveryEnvironments,
      ).toEqual({});
      const state = store.state();
      release();
      account.demandDetail({ family: "hqAppDetail", ownerId: "shop" })();
      yield* settle;
      expect(store.state()).toBe(state);
      yield* first.closed;
      yield* second.closed;
    }),
);
