import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import type { MateOverview } from "@t3tools/shared/mateLink";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { describe, expect, it } from "vite-plus/test";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { makeAccountStore, type Projection } from "../store.ts";
import { hqMates, hqMateOverview, hqMatePresence, hqMateLogins, hqMateReady } from "./hqMates.ts";

const presence = { online: true, since: "2026-10-07T00:00:00Z", overview: "live" } as const;
const mate: MateOverview & { readonly presence: typeof presence } = {
  presence,
  identity: { environmentId: EnvironmentId.make("env-a"), serverVersion: "0.14.35", update: null },
  main: null,
  threads: { list: [], omitted: 0 },
  logins: {},
  crew: { status: "off" },
};
const key = (projectId: string) => ({ orgId: "org", projectId });

describe("keyed HQ Mate readers", () => {
  it("derives/publishes only A while retaining B, login and ready values and source revisions", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const ids = Array.from({ length: 30 }, (_, i) => `mate-${i}`);
    seedHqNavigation(store, "org", { mates: Object.fromEntries(ids.map((id) => [id, mate])) });
    const derives: string[] = [];
    const published: string[] = [];
    const before = { derives: 0, publications: 0 };
    const counted: typeof hqMateOverview = {
      ...hqMateOverview,
      derive: (read, k) => {
        derives.push(k.projectId);
        return hqMateOverview.derive(read, k);
      },
    };
    const stops = ids.map((id) => {
      const atom = store.data.project(counted, key(id));
      return registry.subscribe(
        atom,
        () => {
          registry.get(atom);
          published.push(id);
        },
        { immediate: true },
      );
    });
    const aggregate = store.data.project(hqMates, "org");
    for (const id of ids) {
      const row = Atom.make((get) => {
        before.derives++;
        return get(aggregate).mates[id];
      });
      stops.push(
        registry.subscribe(
          row,
          () => {
            registry.get(row);
            before.publications++;
          },
          { immediate: true },
        ),
      );
    }
    let sections = 0;
    function watch<V>(projection: Projection<ReturnType<typeof key>, V>) {
      const atom = store.data.project(projection, key(ids[0]!));
      stops.push(
        registry.subscribe(
          atom,
          () => {
            registry.get(atom);
            sections++;
          },
          { immediate: true },
        ),
      );
    }
    watch(hqMateLogins);
    watch(hqMateReady);
    watch(hqMatePresence);
    const b = registry.get(store.data.project(counted, key(ids[1]!)));
    const delivery = (
      value: MateOverview & { readonly presence: MateLiveView["presence"] },
      revision: number,
    ) => {
      const { presence: p, ...overview } = value;
      store.dispatch({
        kind: "hq-delivery",
        scopes: [{ scope: hqMateScope("org", ids[0]!), generation: 1 }],
        reset: false,
        rows: [
          {
            family: "hqMate",
            id: ids[0]!,
            value: { presence: p, overview, attention: null, attentionState: "none" },
            revision: { kind: "hq", incarnation: "seed", revision },
          },
        ],
        removals: [],
      });
    };
    derives.length = 0;
    published.length = 0;
    sections = 0;
    before.derives = 0;
    before.publications = 0;
    // A's crew changes; B is never derived. Unrelated sections of A stay stable.
    const changed: typeof mate = { ...mate, crew: { status: "none" } };
    delivery(changed, 10000);
    expect(before).toEqual({ derives: 30, publications: 30 });
    expect(derives).toEqual([ids[0]]);
    expect(published).toEqual([ids[0]]);
    expect(sections).toBe(0);
    expect(registry.get(store.data.project(counted, key(ids[1]!)))).toBe(b);
    derives.length = 0;
    published.length = 0;
    delivery(structuredClone(changed), 10001);
    expect(derives).toEqual([ids[0]]);
    expect(published).toEqual([]);
    expect(registry.get(store.data.fact("hqMate", ids[0]!))).toMatchObject({
      revision: { revision: 10001 },
    });
    delivery(
      {
        ...changed,
        logins: {
          codex: { present: true, token: true, signedInBy: "user", lastSignedInBy: "user" },
        },
      },
      10002,
    );
    expect(sections).toBe(1);
    stops.forEach((stop) => stop());
    registry.dispose();
  });

  it("keeps stored words through outage, withholds removal, and reads missing sections as unknown", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    seedHqNavigation(store, "org", { mates: { a: mate } });
    const overview = store.data.project(hqMateOverview, key("a"));
    const linked = store.data.project(hqMatePresence, key("a"));
    seedHqNavigation(store, "org", {
      mates: { a: { presence: { ...presence, online: false, overview: "stored" } } },
      live: false,
    });
    expect(registry.get(overview)).toEqual({
      presence: { ...presence, online: false, overview: "stored" },
    });
    expect(registry.get(linked).live).toBe(false);
    expect(registry.get(store.data.project(hqMateReady, key("a")))).toBeUndefined();
    expect(registry.get(store.data.project(hqMateLogins, key("a")))).toBeUndefined();
    const scope = placementsScope("org");
    store.dispatch({
      kind: "hq-delivery",
      scopes: [{ scope, generation: 1 }],
      reset: false,
      rows: [],
      removals: [{ family: "placement", id: "a", reason: "no-access" }],
    });
    expect(registry.get(overview)).toBeNull();
    expect(registry.get(store.data.project(hqMates, "org")).mates).toEqual({});
    registry.dispose();
  });
});
