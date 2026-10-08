import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import type { OperationProgress } from "./operation.ts";
import { runningScope } from "../families/process.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import {
  projectRestarts,
  readRestart,
  restartReadout,
  readRestartRecovery,
  NO_RESTARTS,
} from "./restart.ts";

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

// Decision: one derivation per state; consumers never recompute it.
it.each([
  { progress: { stage: "unknown" }, label: "Asking Zerops…", action: null },
  { progress: { stage: "submitting" }, label: "Asking Zerops…", action: null },
  {
    progress: { stage: "unsent", next: "send-again" },
    label: "Try again",
    action: { kind: "retry", requestId: "retry" },
  },
  {
    progress: { stage: "refused", reason: "Access refused." },
    label: "Try again",
    action: { kind: "submit" },
  },
  { progress: { stage: "uncertain", next: "asking-owner" }, label: "Check restart", action: null },
  {
    progress: { stage: "uncertain", next: "ask-owner-again" },
    label: "Check restart",
    action: { kind: "retry", requestId: "retry" },
  },
  {
    progress: { stage: "accepted", operationId: "retry" },
    label: "Restart requested",
    action: null,
  },
  {
    progress: { stage: "reflected", operationId: "retry" },
    label: "Restart requested",
    action: null,
  },
  {
    progress: { stage: "unresolved", operationId: "retry", nextActor: "you" },
    label: "Restart unconfirmed",
    action: null,
  },
  {
    progress: { stage: "done", operationId: "retry", outcome: "failed" },
    label: "Try again",
    action: { kind: "submit" },
  },
  {
    progress: { stage: "done", operationId: "retry", outcome: "cancelled" },
    label: "Try again",
    action: { kind: "submit" },
  },
] satisfies ReadonlyArray<{
  progress: OperationProgress;
  label: string;
  action: NonNullable<ReturnType<typeof readRestart>["retry"]>["action"];
}>)("a $progress.stage restart offers only its safe next intent", ({ progress, label, action }) => {
  expect(
    readRestart(
      { ...NO_RESTARTS, attempts: { [source.id]: { requestId: "retry", progress } } },
      source,
    ).retry,
  ).toEqual({ label, action });
});

it("live and successful restarts expose no recovery press", () => {
  const live = readRestart({ ...NO_RESTARTS, running: [source.id] }, source);
  const done = readRestart(
    {
      ...NO_RESTARTS,
      attempts: {
        [source.id]: {
          requestId: "retry",
          progress: { stage: "done", operationId: "retry", outcome: "succeeded" },
        },
      },
    },
    source,
  );
  expect(live.retry).toBeUndefined();
  expect(done.retry).toBeUndefined();
});

it.each([
  ["CommandExec: init command failed", "its startup command failed"],
  ["ENOSPC: no space left", "its disk is full"],
  ["serviceStack private-id failed", "platform error"],
])(
  "a failed restart names its cause without exposing platform diagnostics (%s)",
  (failReason, cause) => {
    const reading = readRestart(NO_RESTARTS, { ...source, status: "FAILED", failReason });
    expect(restartReadout(reading, "Wren", NaN).text).toBe(
      `Zerops couldn't restart Wren — ${cause}.`,
    );
  },
);

it("the latest deliberate retry supersedes an earlier terminal receipt without falling back to its failure", () => {
  const { store, read } = setup();
  store.dispatch({ kind: "operation-recorded", requestId: "first", intent });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId: "first",
      operationId: "first",
      executor: "zerops",
      affected: [],
      handles: ["failed-retry"],
      acceptance: { kind: "accepted" },
      outcome: { kind: "failed", evidence: "Failed" },
    },
  });
  store.dispatch({ kind: "operation-recorded", requestId: "next", intent });
  store.dispatch({ kind: "operation-uncertain", requestId: "next" });
  store.dispatch({ kind: "operation-lookup-failed", requestId: "next" });
  expect(read()).toMatchObject({
    phase: "uncertain",
    requestId: "next",
    retry: { label: "Check restart", action: { kind: "retry", requestId: "next" } },
  });
});

it("recovery follows the unresolved receipt when history selects the retry destination", () => {
  const process = { ...source, id: "destination" };
  const evidence = {
    ...NO_RESTARTS,
    processes: { destination: process },
    sourceByProcess: { destination: source.id },
    running: ["destination"],
    attempts: {
      [source.id]: {
        requestId: "retry",
        processId: "destination",
        progress: { stage: "unresolved", operationId: "retry", nextActor: "you" } as const,
      },
    },
  };
  expect(readRestartRecovery(evidence, process, "ACTION_FAILED")).toMatchObject({
    state: "failed",
    verb: null,
    actions: ["open-in-zerops"],
  });
});

it("recovery names the selected retry's final start rather than the original restart", () => {
  const destination = {
    ...source,
    id: "destination",
    actionName: "stack.start",
    status: "FAILED",
    failReason: "500: Internal Server Error",
  };
  const evidence = {
    ...NO_RESTARTS,
    processes: { destination },
    attempts: {
      [source.id]: {
        requestId: "retry",
        processId: "destination",
        progress: { stage: "done", operationId: "retry", outcome: "failed" } as const,
      },
    },
  };
  expect(readRestartRecovery(evidence, source, "ACTION_FAILED")).toMatchObject({
    state: "failed",
    verb: "start",
    cause: "Zerops returned an error while starting.",
    actions: ["restart", "open-in-zerops"],
  });
});
