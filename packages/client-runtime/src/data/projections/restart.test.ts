import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { runningScope } from "../families/process.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { projectRestarts, readRestart } from "./restart.ts";

const key = { orgId: ORG, projectId: "p" };
const source = {
  id: "original",
  actionName: "stack.restart",
  status: "RUNNING",
  created: "2026-10-08T10:00:00Z",
  projectId: "p",
  serviceStackIds: ["s"],
};
const intent = {
  kind: "mate-restart",
  ...key,
  serviceId: "s",
  way: "restart",
  sourceProcessId: source.id,
} as const;
const setup = () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [source] }).forEach(store.dispatch);
  const read = () => readRestart(projectRestarts.derive(readsOfState(store.state()), key), source);
  return { store, registry, read };
};

it("a process leaving running membership without a terminal row becomes unconfirmed and stops the active restart", () => {
  const { store, registry, read } = setup();
  const atom = store.data.project(projectRestarts, key);
  let reading = read();
  const release = registry.subscribe(
    atom,
    (evidence) => {
      reading = readRestart(evidence, source);
    },
    { immediate: true },
  );
  expect(reading.phase).toBe("running");
  store.dispatch({
    kind: "membership",
    scope: runningScope(ORG),
    generation: 1,
    delta: { add: [], remove: [source.id] },
  });
  expect(reading.phase).toBe("uncertain");
  release();
});

it.each(["FAILED", "FINISHED"])(
  "reopening a timed-out restart reads its retained %s process after it leaves history",
  (status) => {
    const { store, registry, read } = setup();
    store.dispatch({
      kind: "rows",
      scope: runningScope(ORG),
      generation: 1,
      via: "zerops-realtime",
      method: "push",
      rows: [
        {
          family: "process",
          id: source.id,
          value: { ...source, status },
          revision: { kind: "zerops", version: 2 },
        },
      ],
    });
    const release = registry.subscribe(store.data.project(projectRestarts, key), () => {}, {
      immediate: true,
    });
    release();
    store.dispatch({ kind: "left", scope: runningScope(ORG), generation: 1, id: source.id });
    expect(read().phase).toBe(status === "FAILED" ? "failed" : "done");
    // Forgetting a released scope proves no end; the stale tool RUNNING becomes unconfirmed.
    store.dispatch({ kind: "forget", scopes: [runningScope(ORG)] });
    expect(read().phase).toBe("uncertain");
  },
);

it("an accepted retry with a missing process retains its own identity and never falls back to the original failed process", () => {
  const { store, read } = setup();
  store.dispatch({ kind: "operation-recorded", requestId: "retry", intent });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId: "retry",
      operationId: "retry",
      executor: "zerops",
      affected: [],
      handles: ["new-process"],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    },
  });
  expect(read()).toMatchObject({
    requestId: "retry",
    phase: "uncertain",
    process: { id: "new-process" },
    progress: { stage: "accepted" },
  });
});

it("a terminal receipt settles the visible restart even while its process row still says RUNNING", () => {
  const { store, read } = setup();
  store.dispatch({ kind: "operation-recorded", requestId: "retry", intent });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId: "retry",
      operationId: "retry",
      executor: "zerops",
      affected: [],
      handles: [source.id],
      acceptance: { kind: "accepted" },
      outcome: { kind: "succeeded", evidence: "Finished" },
    },
  });
  expect(read()).toMatchObject({ phase: "done", process: { status: "FINISHED" } });
});
it("lost observation retains last-known process evidence without an active restart", () => {
  const { store, read } = setup();
  expect(read().phase).toBe("running");
  store.dispatch({
    kind: "stream",
    key: `zerops:${ORG}`,
    now: 0,
    event: { kind: "demand", demanded: false },
  });
  expect(read()).toMatchObject({ phase: "uncertain", process: { status: "RUNNING" } });
});
it("an unresolved account receipt cannot keep a retained RUNNING process active", () => {
  const { store, read } = setup();
  store.dispatch({ kind: "operation-recorded", requestId: "retry", intent });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId: "retry",
      operationId: "retry",
      executor: "zerops",
      affected: [],
      handles: [source.id],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    },
  });
  store.dispatch({
    kind: "operation-exhausted",
    requestId: "retry",
    unobservable: { nextActor: "you", nextAction: "Check the process in Zerops." },
  });
  expect(read().phase).toBe("uncertain");
});

it("an unresolved restart retains the account's known handle even without a receipt", () => {
  const { store, read } = setup();
  store.dispatch({
    kind: "operation-recorded",
    requestId: "retry",
    intent,
    handles: ["known-process"],
  });
  store.dispatch({
    kind: "operation-exhausted",
    requestId: "retry",
    unobservable: { nextActor: "you" },
  });
  expect(read()).toMatchObject({
    phase: "uncertain",
    process: { id: "known-process" },
    requestId: "retry",
  });
});
