import { AtomRegistry, type Atom } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { attentionOf, liveHq, liveMate, liveZerops, ORG } from "./__fixtures__/account.ts";
import { scopeKeys } from "./model.ts";
import { menuRow, menuRowKeys } from "./projections/navigation.ts";
import type { AccountInput } from "./reducer.ts";
import { makeAccountStore, type Projection } from "./store.ts";

const projects = scopeKeys.projects(ORG);

const attach: ReadonlyArray<AccountInput> = [
  {
    kind: "stream",
    key: scopeKeys.zeropsLink(ORG),
    now: 0,
    event: { kind: "demand", demanded: true },
  },
  { kind: "stream", key: projects, now: 0, event: { kind: "demand", demanded: true } },
  { kind: "stream", key: projects, now: 0, event: { kind: "attempt" } },
];

const projectRows = (...rows: ReadonlyArray<readonly [string, number]>): AccountInput => ({
  kind: "rows",
  scope: projects,
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: rows.map(([id, version]) => ({
    family: "project" as const,
    id,
    value: { id, name: id, status: "ACTIVE" },
    revision: { kind: "zerops" as const, version },
  })),
});

describe("makeAccountStore", () => {
  it("publishes a reduction to the keys it changed and to no other", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    attach.forEach(store.dispatch);
    const heard: string[] = [];
    for (const id of ["p1", "p2"])
      registry.subscribe(store.data.fact("project", id), () => heard.push(id));

    store.dispatch(projectRows(["p1", 1]));

    expect(heard).toEqual(["p1"]);
    expect(registry.get(store.data.fact("project", "p1"))).toMatchObject({
      kind: "known",
      value: { id: "p1" },
      scope: projects,
    });
    expect(registry.get(store.data.fact("project", "p2"))).toEqual({ kind: "unknown" });
  });

  it("recomputes only the busy Mate's row while 100 menu rows are mounted", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const apps = Array.from({ length: 100 }, (_, index) => `app-${index}`);
    [
      liveZerops({
        projects: apps.flatMap((app) => [
          { id: `${app}-mate`, name: `${app} mate` },
          { id: `${app}-stage`, name: `${app} stage` },
        ]),
      }),
      liveHq({
        placements: apps.flatMap((app) => [
          { projectId: `${app}-mate`, appId: app, role: "mate" },
          { projectId: `${app}-stage`, appId: app, role: "stage" },
        ]),
      }),
      liveMate("app-0-mate", attentionOf(), 1),
    ]
      .flat()
      .forEach(store.dispatch);

    const derived = new Map<string, number>();
    const counted = <K, V>(projection: Projection<K, V>): Projection<K, V> => ({
      ...projection,
      derive: (read, key) => {
        const name = `${projection.name}/${projection.keyOf(key)}`;
        derived.set(name, (derived.get(name) ?? 0) + 1);
        return projection.derive(read, key);
      },
    });
    const rows = counted(menuRow);
    const roster = counted(menuRowKeys);
    // A render: every mounted atom is read again whenever it says it changed.
    const mount = <Value>(atom: Atom.Atom<Value>) =>
      registry.subscribe(atom, () => void registry.get(atom), { immediate: true });
    mount(store.data.project(roster, ORG));
    const keys = registry.get(store.data.project(roster, ORG));
    expect(keys).toHaveLength(100);
    for (const row of keys) mount(store.data.project(rows, { orgId: ORG, row }));
    derived.clear();

    // A busy conversation: the open Mate's attention moves fifty times, its stage deploys once.
    for (let revision = 2; revision <= 51; revision += 1)
      store.dispatch({
        kind: "rows",
        scope: scopeKeys.attention("app-0-mate"),
        generation: 1,
        method: "push",
        via: "mate-direct",
        rows: [
          {
            family: "attention",
            id: "app-0-mate",
            value: attentionOf({ working: 1, latestChatId: `chat-${revision}` }),
            revision: { kind: "mate-attention", incarnation: "inc-1", revision },
          },
        ],
      });
    store.dispatch({
      kind: "rows",
      scope: scopeKeys.running(ORG),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "process",
          id: "deploy-0",
          value: { id: "deploy-0", projectId: "app-0-stage", status: "RUNNING", actionName: null },
          revision: { kind: "zerops", version: 1 },
        },
      ],
    });

    expect([...derived]).toEqual([[`menuRow/${ORG}/app/app-0`, 51]]);
    expect(
      registry.get(store.data.project(rows, { orgId: ORG, row: { kind: "app", appId: "app-0" } })),
    ).toMatchObject({ running: { kind: "ready", value: true } });
  });
});
