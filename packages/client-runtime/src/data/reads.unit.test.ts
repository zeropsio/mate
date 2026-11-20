import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { liveZerops, ORG } from "./__fixtures__/account.ts";
import { detailScopeOf, type DetailDemand } from "./demand.ts";
import type { StreamEvent } from "./streamMachine.ts";
import { linkKeys } from "./model.ts";
import { mateVariablesScope } from "./families/mateVariables.ts";
import {
  accountReadsAtom,
  projectPublicAccessAtom,
  projectStandingAtom,
  readMateFlag,
  readMateFlagOnceLive,
} from "./reads.ts";
import { makeAccountStore, readsOfState } from "./store.ts";
import { projectRoutingsScope, routingsScope } from "./families/publicRouting.ts";

// witness: packages/client-runtime/src/data/reads.ts | return get(account.data.project(projectStanding, → return get.once(account.data.project(projectStanding,
it("ST31: A denied or deleted project keeps its name for recovery without exposing its protected record", () => {
  for (const kind of ["denied", "deleted"] as const) {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    liveZerops({
      running: [],
      projects: [{ id: "p1", name: "Shop", description: "Private project description" }],
    }).forEach(store.dispatch);
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: ORG,
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
    const atom = projectStandingAtom("p1");
    const unmount = registry.mount(atom);
    expect(registry.get(atom)).toMatchObject({ kind: "listed", project: { name: "Shop" } });

    store.dispatch(
      kind === "denied"
        ? { kind: "access", family: "project", id: "p1", access: "denied" }
        : { kind: "proven-deletion", family: "project", id: "p1", evidence: "projectNotFound" },
    );
    expect(registry.get(atom)).toEqual({ kind, name: "Shop" });
    expect(readsOfState(store.state()).fact("project", "p1")).not.toHaveProperty("value");
    unmount();
    store.close();
    registry.dispose();
  }
});

// witness: packages/client-runtime/src/data/reads.ts | if (account !== null && get(readsProject)) → if (account !== null && !get(readsProject))
it("ST32: A project's public access is read from its own routings while the organization's routings are refused, held until the account closes", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [{ id: "p1" }], services: [] }).forEach(store.dispatch);
  const demands: DetailDemand[] = [];
  const held = new Set<string>();
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: ORG,
    demandDetail: (demand) => {
      demands.push(demand);
      held.add(demand.ownerId);
      return () => void held.delete(demand.ownerId);
    },
    renewHeld: () => {},
  });
  const atom = projectPublicAccessAtom("p1");
  const stop = registry.mount(atom);
  const scope = routingsScope(ORG);
  for (const event of [
    { kind: "demand", demanded: true },
    { kind: "attempt" },
    {
      kind: "fault",
      fault: { outcome: "authoritative-denial", message: "Insufficient permissions" },
      jitter: 0,
    },
  ] as const)
    store.dispatch({ kind: "stream", key: scope, now: 0, event });
  expect(registry.get(atom).readsProject).toBe(true);
  expect(demands).toEqual([{ family: "publicRouting", listing: "projectRoutings", ownerId: "p1" }]);
  const own = projectRoutingsScope(ORG, "p1");
  for (const event of [
    { kind: "demand", demanded: true },
    { kind: "attempt" },
    { kind: "handshake" },
  ] as const)
    store.dispatch({ kind: "stream", key: own, now: 0, event });
  store.dispatch({ kind: "baseline-begin", scope: own, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope: own,
    generation: 1,
    via: "zerops-realtime",
    members: [],
    rows: [],
  });
  store.dispatch({ kind: "stream", key: own, now: 0, event: { kind: "baseline-committed" } });
  expect(registry.get(atom).state).toBe("ready");
  expect([...held]).toEqual(["p1"]);
  registry.set(accountReadsAtom, null);
  expect(registry.get(atom).readsProject).toBe(false);
  expect([...held]).toEqual([]);
  stop();
  registry.dispose();
});

const SCOPE = mateVariablesScope(ORG, "zcp");
/** The account mounted over the organization's live link; demands reach its store as the adapter's do. */
const mounted = () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], services: [{ id: "zcp", projectId: "p1" }] }).forEach(store.dispatch);
  const holds: Array<string> = [];
  let notifyDemand: (() => void) | undefined;
  registry.set(accountReadsAtom, {
    renewHeld: () => {},
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
      notifyDemand?.();
      notifyDemand = undefined;
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
          value: { flag: content === undefined ? null : content === "1" },
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
  const nextDemand = () => new Promise<void>((resolve) => (notifyDemand = resolve));
  return { registry, store, answer, nextDemand };
};
/** What the read answered once every answer already due has run; `pending` if none did. */
const settled = async <T>(promise: Promise<T>): Promise<T | "pending"> => {
  let answer: T | "pending" = "pending";
  void promise.then((value) => {
    answer = value;
  });
  // These reads settle through Promise reactions after synchronous store updates.
  await new Promise<void>((resolve) => setImmediate(resolve));
  return answer;
};

// witness: packages/client-runtime/src/data/reads.ts | if (stream.phase === "live") { → if (stream.phase === "live" || typeof get(account.data.project(mateVariables, { orgId: account.orgId, serviceId })).flag === "boolean") {
it("ST33: A Mate's flag read waits for a fresh answer, never the one a let-go read last gave", async () => {
  const { registry, answer } = mounted();
  const first = readMateFlag(registry, "zcp");
  answer("0");
  expect(await first).toBe(false);

  const again = readMateFlag(registry, "zcp");
  expect(await settled(again)).toBe("pending");
  answer("1");
  expect(await again).toBe(true);
});

// witness: packages/client-runtime/src/data/reads.ts | return stream.phase === "connecting" || → if (stream.phase === "refused") return false; return stream.phase === "connecting" ||
it("ST34: A refused Mate flag read is unknown, never off", async () => {
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

// witness: packages/client-runtime/src/data/reads.ts | before === null || before === "live" → before === null || before !== "live"
it("ST35: A Mate's flag that could not be read while the organization's link was down is read again once the link is live, and stays unknown when the link is refused", async () => {
  for (const { back, flag } of [
    { back: true, flag: true },
    { back: false, flag: "unknown" },
  ] as const) {
    const { registry, store, answer, nextDemand } = mounted();
    const link = (event: StreamEvent) =>
      store.dispatch({ kind: "stream", key: linkKeys.zerops(ORG), now: 0, event });
    link({ kind: "fault", fault: { outcome: "transient", message: "socket closed" }, jitter: 0 });
    const read = readMateFlagOnceLive(registry, "zcp");
    expect(await settled(read)).toBe("pending");

    if (back) {
      const requested = nextDemand();
      link({ kind: "retry-due" });
      link({ kind: "handshake" });
      link({ kind: "baseline-committed" });
      await requested;
      answer("1");
    } else {
      link({
        kind: "fault",
        fault: { outcome: "definitive-refusal", message: "refused" },
        jitter: 0,
      });
    }

    expect(await read).toBe(flag);
  }
});
