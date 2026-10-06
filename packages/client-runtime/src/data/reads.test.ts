import { AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "./__fixtures__/account.ts";
import { detailScopeOf } from "./demand.ts";
import { linkKeys } from "./model.ts";
import { mateVariablesScope } from "./families/mateVariables.ts";
import {
  accountReadsAtom,
  holdProjectHistory,
  holdServiceRead,
  NOT_READ_PROCESSES,
  NOT_READ_SERVICES,
  NOT_READ_USAGE,
  readMateFlag,
  readMateMarker,
  projectProcessesAtom,
  projectUsageAtom,
  projectServicesAtom,
  projectsServicesAtom,
} from "./reads.ts";
import { makeAccountStore } from "./store.ts";
import { usageOwnerOf, usageScope } from "./families/usage.ts";

describe("projectProcessesAtom", () => {
  it("reads a project's processes through the mounted account, and nothing without one", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [{ id: "build", projectId: "p1" }] }).forEach(store.dispatch);
    const atom = projectProcessesAtom("p1");
    expect(registry.get(atom)).toEqual(NOT_READ_PROCESSES);

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    expect(registry.get(atom).running.map((process) => process.id)).toEqual(["build"]);

    registry.set(accountReadsAtom, { data: store.data, orgId: null, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_PROCESSES);
  });
});

describe("projectServicesAtom", () => {
  it("reads a project's services through the mounted account, and nothing without one", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      projects: [{ id: "p1" }],
      services: [{ id: "zcp", projectId: "p1" }],
    }).forEach(store.dispatch);
    const atom = projectServicesAtom("p1");
    expect(registry.get(atom)).toEqual(NOT_READ_SERVICES);

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    expect(registry.get(atom).services?.map((service) => service.id)).toEqual(["zcp"]);

    registry.set(accountReadsAtom, { data: store.data, orgId: null, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_SERVICES);
  });
});

describe("projectUsageAtom", () => {
  it("reads a project's resources through the mounted account, and nothing without one", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const atom = projectUsageAtom(usageOwnerOf(ORG, "p1"));
    expect(registry.get(atom)).toEqual(NOT_READ_USAGE);

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_USAGE);
    store.dispatch({
      kind: "stream",
      key: usageScope(ORG, usageOwnerOf(ORG, "p1")),
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "definitive-refusal", message: "HTTP 400" },
      },
    });
    expect(registry.get(atom).failure).toBe("HTTP 400");

    registry.set(accountReadsAtom, { data: store.data, orgId: null, demandDetail: () => () => {} });
    expect(registry.get(atom)).toEqual(NOT_READ_USAGE);
  });
});

describe("projectsServicesAtom", () => {
  it("reads several projects' services at once through the mounted account", () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      projects: [{ id: "p1" }, { id: "p2" }],
      services: [
        { id: "zcp", projectId: "p1" },
        { id: "db", projectId: "p2" },
      ],
    }).forEach(store.dispatch);
    const atom = projectsServicesAtom("p1,p2");
    expect(registry.get(atom)).toEqual({});

    registry.set(accountReadsAtom, { data: store.data, orgId: ORG, demandDetail: () => () => {} });
    const read = registry.get(atom);
    expect([read.p1?.services?.[0]?.id, read.p2?.services?.[0]?.id]).toEqual(["zcp", "db"]);
  });
});

describe("holdProjectHistory", () => {
  it("holds a project's history through whichever account is mounted, and lets go once", () => {
    const registry = AtomRegistry.make();
    const held: string[] = [];
    const reads = (name: string) => ({
      data: makeAccountStore(registry).data,
      orgId: ORG,
      demandDetail: (demand: { readonly ownerId: string }) => {
        held.push(`${name} ${demand.ownerId}`);
        return () => void held.splice(held.indexOf(`${name} ${demand.ownerId}`), 1);
      },
    });
    const release = holdProjectHistory(registry, "p1");
    expect(held).toEqual([]);
    registry.set(accountReadsAtom, reads("first"));
    expect(held).toEqual(["first p1"]);
    registry.set(accountReadsAtom, reads("second"));
    expect(held).toEqual(["second p1"]);
    release();
    release();
    expect(held).toEqual([]);
  });
});

describe("holdServiceRead", () => {
  it("holds one service's own read through the mounted account, and lets go once", () => {
    const registry = AtomRegistry.make();
    const held: string[] = [];
    registry.set(accountReadsAtom, {
      data: makeAccountStore(registry).data,
      orgId: ORG,
      demandDetail: (demand: { readonly listing?: string; readonly ownerId: string }) => {
        held.push(`${demand.listing} ${demand.ownerId}`);
        return () => void held.splice(held.indexOf(`${demand.listing} ${demand.ownerId}`), 1);
      },
    });
    const release = holdServiceRead(registry, "s1");
    expect(held).toEqual(["service s1"]);
    release();
    release();
    expect(held).toEqual([]);
  });
});

describe("readMateFlag", () => {
  const SCOPE = mateVariablesScope(ORG, "zcp");
  /** The account mounted over the organization's live link; demands reach its store as the adapter's do. */
  const mounted = () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], services: [{ id: "zcp", projectId: "p1" }] }).forEach(store.dispatch);
    const holds: Array<string> = [];
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: ORG,
      demandDetail: (demand) => {
        const scope = detailScopeOf(ORG, demand);
        holds.push(scope);
        store.dispatch({
          kind: "stream",
          key: scope,
          now: 0,
          event: { kind: "demand", demanded: true },
        });
        return () => {
          holds.splice(holds.indexOf(scope), 1);
          if (!holds.includes(scope))
            store.dispatch({
              kind: "stream",
              key: scope,
              now: 0,
              event: { kind: "demand", demanded: false },
            });
        };
      },
    });
    let generation = 0;
    /** Its search answers: `zcp`'s flag as written, absent where `undefined`. */
    const answer = (content: string | undefined) => {
      generation += 1;
      for (const event of [{ kind: "attempt" }, { kind: "handshake" }] as const)
        store.dispatch({ kind: "stream", key: SCOPE, now: 0, event });
      store.dispatch({ kind: "baseline-begin", scope: SCOPE, generation });
      store.dispatch({
        kind: "baseline-commit",
        scope: SCOPE,
        generation,
        via: "zerops-read",
        members: ["zcp"],
        rows: [
          {
            family: "mateVariables",
            id: "zcp",
            value: { flag: content === undefined ? null : content === "1", marker: false },
            revision: { kind: "zerops", version: null },
          },
        ],
      });
      store.dispatch({
        kind: "stream",
        key: SCOPE,
        now: 0,
        event: { kind: "baseline-committed" },
      });
    };
    return { registry, store, holds, answer };
  };
  /** What the read answered once every answer already due has run; `pending` if none did. */
  const settled = async <T>(promise: Promise<T>): Promise<T | "pending"> => {
    let answer: T | "pending" = "pending";
    void promise.then((value) => {
      answer = value;
    });
    for (let turn = 0; turn < 3; turn += 1) await Promise.resolve();
    return answer;
  };

  it("reads one container's variables for the asking, and lets them go once answered", async () => {
    const { registry, holds, answer } = mounted();
    const flag = readMateFlag(registry, "zcp");
    expect(holds).toEqual([SCOPE]);
    expect(await settled(flag)).toBe("pending");

    answer("1");
    expect(await flag).toBe(true);
    expect(holds).toEqual([]);
  });

  it("an absent flag reads off", async () => {
    const { registry, answer } = mounted();
    const flag = readMateFlag(registry, "zcp");
    answer(undefined);
    expect(await flag).toBe(false);
  });

  it("waits for a fresh answer, never the one a let-go read last gave", async () => {
    const { registry, answer } = mounted();
    const first = readMateFlag(registry, "zcp");
    answer("0");
    expect(await first).toBe(false);

    const again = readMateFlag(registry, "zcp");
    expect(await settled(again)).toBe("pending");
    answer("1");
    expect(await again).toBe(true);
  });

  it("a refused read is unknown, never off", async () => {
    const { registry, store } = mounted();
    const flag = readMateFlag(registry, "zcp");
    store.dispatch({ kind: "stream", key: SCOPE, now: 0, event: { kind: "attempt" } });
    store.dispatch({
      kind: "stream",
      key: SCOPE,
      now: 0,
      event: {
        kind: "fault",
        fault: { outcome: "authoritative-denial", message: "HTTP 403" },
        jitter: 0,
      },
    });
    expect(await flag).toBe("unknown");
  });

  it("with the organization's link down, unknown at once, never a wait", async () => {
    const { registry, store } = mounted();
    store.dispatch({
      kind: "stream",
      key: linkKeys.zerops(ORG),
      now: 0,
      event: {
        kind: "fault",
        fault: { outcome: "transient", message: "socket closed" },
        jitter: 0,
      },
    });
    expect(await settled(readMateFlag(registry, "zcp"))).toBe("unknown");
  });

  it("without a mounted account, unknown", async () => {
    expect(await readMateFlag(AtomRegistry.make(), "zcp")).toBe("unknown");
  });
});

describe("readMateMarker", () => {
  it("reads whether a container carries the press's marker for the asking", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({ running: [], services: [{ id: "zcp", projectId: "p1" }] }).forEach(store.dispatch);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: ORG,
      demandDetail: (demand) => {
        const scope = detailScopeOf(ORG, demand);
        for (const event of [
          { kind: "demand", demanded: true },
          { kind: "attempt" },
          { kind: "handshake" },
        ] as const)
          store.dispatch({ kind: "stream", key: scope, now: 0, event });
        store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
        store.dispatch({
          kind: "baseline-commit",
          scope,
          generation: 1,
          via: "zerops-read",
          members: [demand.ownerId],
          rows: [
            {
              family: "mateVariables",
              id: demand.ownerId,
              value: { flag: true, marker: true },
              revision: { kind: "zerops", version: null },
            },
          ],
        });
        store.dispatch({
          kind: "stream",
          key: scope,
          now: 0,
          event: { kind: "baseline-committed" },
        });
        return () => undefined;
      },
    });
    expect(await readMateMarker(registry, "zcp")).toBe(true);
  });
});
