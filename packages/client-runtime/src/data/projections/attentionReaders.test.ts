import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { initialEnvironment } from "../../zerops/environments/environmentMachine.ts";
import { initialContainer } from "../../zerops/environments/containerMachine.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { mateLinkScope, type MateLinkValue } from "../families/mateLink.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { accountReadsAtom, hqMateOverviewAtom, mateAttentionAtom } from "../reads.ts";
import { makeAccountStore } from "../store.ts";
import { attentionProjects, mateAttention, matesAttention } from "./mateAttention.ts";

describe("stable attention readers", () => {
  it("enumerates current source and direct projects without list-key accumulation, preserving removal and org identity", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    seedHqNavigation(store, "org", {
      mates: { a: { presence: { online: true, since: "now", overview: "none" } } },
    });
    const enumeration = store.data.project(matesAttention, "org");
    const publishLink = (orgId: string | null, shown: boolean, sequence: number) => {
      const value: MateLinkValue = {
        key: "direct:service",
        projectId: "direct",
        orgId,
        origin: null,
        shown,
        watched: true,
        environment: initialEnvironment({ record: null }),
        container: initialContainer(),
      };
      store.dispatch({
        kind: "rows",
        scope: mateLinkScope("direct"),
        generation: 0,
        method: "read",
        via: "mate-direct",
        rows: [
          { family: "mateLink", id: value.key, value, revision: { kind: "mate-link", sequence } },
        ],
      });
    };
    expect(Object.keys(registry.get(enumeration))).toEqual(["a"]);
    publishLink(null, true, 1);
    expect(Object.keys(registry.get(enumeration))).toEqual(["a", "direct"]);
    expect(store.data.project(matesAttention, "org")).toBe(enumeration);
    expect(store.data.project(mateAttention, { orgId: "org", projectId: "a" })).toBe(
      store.data.project(mateAttention, { projectId: "a", orgId: "org" }),
    );
    publishLink("other-org", true, 2);
    expect(Object.keys(registry.get(enumeration))).toEqual(["a"]);
    publishLink("org", false, 3);
    expect(registry.get(store.data.project(attentionProjects, "org"))).toEqual(["a"]);
    store.dispatch({
      kind: "hq-delivery",
      scopes: [{ scope: placementsScope("org"), generation: 1 }],
      reset: false,
      rows: [],
      removals: [{ family: "placement", id: "a", reason: "no-access" }],
    });
    expect(registry.get(enumeration)).toEqual({});
    registry.dispose();
  });

  it("shares simultaneous holders and releases their dependencies after the last release", () => {
    const tasks: Array<() => void> = [];
    const registry = AtomRegistry.make({
      scheduleTask: (task) => {
        let cancelled = false;
        tasks.push(() => {
          if (!cancelled) task();
        });
        return () => {
          cancelled = true;
        };
      },
    });
    const drain = () => {
      while (tasks.length) tasks.shift()!();
    };
    const store = makeAccountStore(registry);
    let derives = 0;
    const counted: typeof mateAttention = {
      ...mateAttention,
      derive: (read, key) => {
        derives++;
        return mateAttention.derive(read, key);
      },
    };
    const atom = store.data.project(counted, { orgId: "org", projectId: "a" });
    const one = registry.subscribe(atom, () => registry.get(atom), { immediate: true });
    const two = registry.subscribe(atom, () => registry.get(atom), { immediate: true });
    expect(derives).toBe(1);
    one();
    drain();
    seedHqNavigation(store, "org", {
      mates: { a: { presence: { online: true, since: "now", overview: "none" } } },
    });
    expect(derives).toBeGreaterThan(1);
    two();
    drain();
    derives = 0;
    seedHqNavigation(store, "org", {
      mates: { a: { presence: { online: false, since: "later", overview: "none" } } },
    });
    expect(derives).toBe(0);
    const again = registry.subscribe(atom, () => registry.get(atom), { immediate: true });
    expect(derives).toBe(1);
    again();
    drain();
    registry.dispose();
  });

  it("moves keyed rows to the current org/account and releases the old store", () => {
    const registry = AtomRegistry.make();
    const old = makeAccountStore(registry);
    const next = makeAccountStore(registry);
    const presence = { online: true, since: "now", overview: "none" } as const;
    seedHqNavigation(old, "old", { mates: { a: { presence, crew: { status: "off" } } } });
    seedHqNavigation(next, "new", { mates: { a: { presence, crew: { status: "none" } } } });
    const mount = (orgId: string, data: typeof old.data) =>
      registry.set(accountReadsAtom, {
        orgId,
        data,
        demandDetail: () => () => {},
        renewHeld: () => {},
      });
    mount("old", old.data);
    const atom = hqMateOverviewAtom("a");
    const stop = registry.subscribe(atom, () => registry.get(atom), { immediate: true });
    expect(registry.get(atom)?.crew?.status).toBe("off");
    mount("new", next.data);
    expect(registry.get(atom)?.crew?.status).toBe("none");
    old.close();
    registry.set(accountReadsAtom, null);
    expect(registry.get(atom)).toBeNull();
    expect(registry.get(mateAttentionAtom("a"))).toEqual({
      attention: null,
      live: false,
      unseen: null,
    });
    stop();
    registry.dispose();
  });
});
