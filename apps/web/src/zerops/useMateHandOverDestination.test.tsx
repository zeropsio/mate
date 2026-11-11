// @vitest-environment happy-dom
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { mateEngineHostAtom, mateFeedReadsAtom } from "@t3tools/client-runtime/data";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { act, createElement as h } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useThreadDetail, useThreadStatus } from "../state/entities";
import { useMateHandOver } from "./newMate";
import { useMateHandOverDestination } from "./useMateHandOverDestination";
import { useZeropsAgentAuth } from "./useZeropsFeeds";

const demand = vi.hoisted(() => ({
  held: new Set<string>(),
  events: [] as string[],
}));

const resources = Atom.family((key: string) =>
  Atom.make((get) => {
    const host = key.startsWith("auth:") ? get(mateFeedReadsAtom) : get(mateEngineHostAtom);
    if (host === null) return null;
    demand.held.add(key);
    demand.events.push(`hold ${key}`);
    get.addFinalizer(() => {
      demand.held.delete(key);
      demand.events.push(`release ${key}`);
    });
    return key;
  }),
);
const empty = Atom.make(null);

function useConversation(ref: ScopedThreadRef | null) {
  return useAtomValue(
    ref === null ? empty : resources(`conversation:${ref.environmentId}/${ref.threadId}`),
  );
}

vi.mock("../state/entities", () => ({
  useThreadStatus: (ref: ScopedThreadRef | null) => useConversation(ref),
  useThreadDetail: (ref: ScopedThreadRef | null) => useConversation(ref),
}));
vi.mock("./useZeropsFeeds", () => ({
  useZeropsAgentAuth: (environmentId: EnvironmentId | null) =>
    useAtomValue(environmentId === null ? empty : resources(`auth:${environmentId}`)),
}));

const conversation: ScopedThreadRef = {
  environmentId: EnvironmentId.make("env-new-mate"),
  threadId: ThreadId.make("thread-first"),
};
const expectedResources = ["auth:env-new-mate", "conversation:env-new-mate/thread-first"];
const engine = {} as NonNullable<Atom.Type<typeof mateEngineHostAtom>>;
const feeds = {} as NonNullable<Atom.Type<typeof mateFeedReadsAtom>>;
let atoms: AtomRegistry.AtomRegistry;
let tree: ReactTestRenderer | undefined;
let scheduled: Set<() => void>;

function SourceReads({ ref }: { readonly ref: ScopedThreadRef }) {
  useThreadStatus(ref);
  useThreadDetail(ref);
  useZeropsAgentAuth(ref.environmentId);
  return null;
}

function Source() {
  const pending = useMateHandOver((state) => state.handOver);
  return pending === null ? null : h(SourceReads, { ref: pending });
}

function Destination({
  ref,
  id,
}: {
  readonly ref: ScopedThreadRef | null;
  readonly id: string | undefined;
}) {
  useMateHandOverDestination(ref, id);
  return null;
}

const render = (ref: ScopedThreadRef | null, id: string | undefined, destination = true) => {
  const view = h(
    RegistryContext.Provider,
    { value: atoms },
    h(Source),
    destination ? h(Destination, { ref, id }) : null,
  );
  act(() => {
    if (tree === undefined) tree = create(view);
    else tree.update(view);
  });
};

const flush = () => {
  act(() => {
    while (scheduled.size > 0) {
      const tasks = [...scheduled];
      scheduled.clear();
      for (const task of tasks) task();
    }
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scheduled = new Set();
  atoms = AtomRegistry.make({
    scheduleTask: (task) => {
      scheduled.add(task);
      return () => scheduled.delete(task);
    },
  });
  demand.held.clear();
  demand.events = [];
  useMateHandOver.getState().handingOver(null);
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  atoms.dispose();
  useMateHandOver.getState().handingOver(null);
  vi.unstubAllGlobals();
});

it("the destination acquires the exact conversation and sign-in demand before the source releases them", () => {
  atoms.set(mateEngineHostAtom, engine);
  atoms.set(mateFeedReadsAtom, feeds);
  const id = useMateHandOver.getState().handingOver(conversation);
  render(null, undefined, false);
  flush();
  expect([...demand.held].sort()).toEqual(expectedResources);

  render(conversation, id);
  flush();
  expect(useMateHandOver.getState().handOver).toBeNull();
  expect([...demand.held].sort()).toEqual(expectedResources);
  expect(demand.events).toEqual([
    "hold conversation:env-new-mate/thread-first",
    "hold auth:env-new-mate",
  ]);

  render(null, undefined, false);
  flush();
  expect([...demand.held]).toEqual([]);
  expect(demand.events.slice(2).sort()).toEqual([
    "release auth:env-new-mate",
    "release conversation:env-new-mate/thread-first",
  ]);
});

it("late account hosts acquire both destination resources before acknowledging the handover", () => {
  const id = useMateHandOver.getState().handingOver(conversation);
  render(conversation, id);
  flush();
  expect(useMateHandOver.getState().handOver).toEqual(conversation);
  expect([...demand.held]).toEqual([]);

  act(() => atoms.set(mateEngineHostAtom, engine));
  flush();
  expect(useMateHandOver.getState().handOver).toEqual(conversation);
  expect([...demand.held]).toEqual(["conversation:env-new-mate/thread-first"]);

  act(() => atoms.set(mateFeedReadsAtom, feeds));
  flush();
  expect(useMateHandOver.getState().handOver).toBeNull();
  expect([...demand.held].sort()).toEqual(expectedResources);
  expect(demand.events.filter((event) => event.startsWith("release"))).toEqual([]);
});

it.each([
  {
    label: "environment",
    ref: { ...conversation, environmentId: EnvironmentId.make("env-other") },
    held: [
      "auth:env-new-mate",
      "auth:env-other",
      "conversation:env-new-mate/thread-first",
      "conversation:env-other/thread-first",
    ],
  },
  {
    label: "conversation",
    ref: { ...conversation, threadId: ThreadId.make("thread-other") },
    held: [
      "auth:env-new-mate",
      "conversation:env-new-mate/thread-first",
      "conversation:env-new-mate/thread-other",
    ],
  },
  { label: "handover", ref: conversation, held: expectedResources },
])("a destination for another $label cannot acknowledge the source", ({ label, ref, held }) => {
  atoms.set(mateEngineHostAtom, engine);
  atoms.set(mateFeedReadsAtom, feeds);
  const id = useMateHandOver.getState().handingOver(conversation);
  render(ref, label === "handover" ? "another-handover" : id);
  flush();
  expect(useMateHandOver.getState().handOver).toEqual(conversation);
  expect([...demand.held].sort()).toEqual(held);
});

it("an old destination cannot release a replacement handover to the same conversation", () => {
  const oldId = useMateHandOver.getState().handingOver(conversation);
  render(conversation, oldId);
  let replacementId = oldId;
  act(() => {
    replacementId = useMateHandOver.getState().handingOver({ ...conversation });
  });
  act(() => {
    atoms.set(mateEngineHostAtom, engine);
    atoms.set(mateFeedReadsAtom, feeds);
  });
  flush();
  expect(useMateHandOver.getState().handOverId).toBe(replacementId);
  expect(useMateHandOver.getState().handOver).toEqual(conversation);
  render(null, undefined, false);
  flush();
  expect(useMateHandOver.getState().handOver).toEqual(conversation);
  expect([...demand.held].sort()).toEqual(expectedResources);
});

it("leaving a destination before account hosts arrive cancels its own source demand", () => {
  const id = useMateHandOver.getState().handingOver(conversation);
  render(conversation, id);
  expect(useMateHandOver.getState().handOver).toEqual(conversation);

  render(null, id);
  flush();
  expect(useMateHandOver.getState().handOver).toBeNull();
  expect([...demand.held]).toEqual([]);
});

it("a stale destination losing its route cannot cancel a replacement waiting for account hosts", () => {
  const oldId = useMateHandOver.getState().handingOver(conversation);
  render(conversation, oldId);
  let replacementId = oldId;
  act(() => {
    replacementId = useMateHandOver.getState().handingOver({ ...conversation });
  });

  render(null, oldId);
  flush();
  expect(useMateHandOver.getState().handOverId).toBe(replacementId);
  expect(useMateHandOver.getState().handOver).toEqual(conversation);
  act(() => {
    atoms.set(mateEngineHostAtom, engine);
    atoms.set(mateFeedReadsAtom, feeds);
  });
  flush();
  expect(useMateHandOver.getState().handOver).toEqual(conversation);
  expect([...demand.held].sort()).toEqual(expectedResources);
});
