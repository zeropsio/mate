import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  makeAccountStore,
  makeWorkspaceReads,
  makeWorkspaceActions,
  makeFileWrites,
  makeVcsReads,
  workspaceReading,
} from "@t3tools/client-runtime/data";
import { vcsStatus, workspaceCommand, workspaceHostAtom, workspaceQuery } from "./workspace";

it("MCP changes apply in the order requested and cannot publish an older action last", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const calls: boolean[] = [];
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: (value: import("@t3tools/contracts").McpServersList) => void;
  const reads = makeWorkspaceReads(store, { read: () => Effect.never });
  const vcs = makeVcsReads(store, () => Stream.never);
  let id = 0;
  const act = makeWorkspaceActions({
    store,
    current: () => true,
    makeId: () => `mcp-${++id}`,
    mcpAnswer: reads.mcpAnswer,
    wire: {
      call: (_kind, target) => {
        calls.push("enabled" in target.input && target.input.enabled === true);
        return calls.length === 1
          ? Effect.promise(() => {
              entered();
              return new Promise<import("@t3tools/contracts").McpServersList>((resolve) => {
                release = resolve;
              });
            })
          : Effect.succeed({ servers: [], agents: ["codex"] });
      },
    } as Parameters<typeof makeWorkspaceActions>[0]["wire"],
  });
  registry.set(workspaceHostAtom, {
    data: store.data,
    reads,
    vcs,
    act,
    writeFile: makeFileWrites({
      store,
      reads,
      current: () => true,
      makeId: () => "save",
      write: () => Effect.succeed({ relativePath: "a" }),
    }),
  });
  const command = workspaceCommand("mate-mcp-set-enabled");
  const environmentId = EnvironmentId.make("mate");
  const first = command.run(registry, { environmentId, input: { name: "tool", enabled: true } });
  await started;
  const second = command.run(registry, { environmentId, input: { name: "tool", enabled: false } });
  expect(calls).toEqual([true]);
  release({ servers: [], agents: [] });
  await Promise.all([first, second]);
  expect(calls).toEqual([true, false]);
  expect(
    registry.get(store.data.project(workspaceReading("mcp"), { environmentId, input: {} })).result,
  ).toMatchObject({ _tag: "Success", value: { agents: ["codex"] } });
  reads.close();
  vcs.close();
  registry.dispose();
});

it("the history binding keeps owner evidence without changing the projected result", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const reads = makeWorkspaceReads(store, {
    read: () => Effect.fail({ outcome: "definitive-refusal", message: "History source refused." }),
  });
  const vcs = makeVcsReads(store, () => Stream.never);
  registry.set(workspaceHostAtom, {
    data: store.data,
    reads,
    vcs,
    act: makeWorkspaceActions({
      store,
      current: () => true,
      makeId: () => "action",
      mcpAnswer: reads.mcpAnswer,
      wire: { call: () => Effect.never },
    }),
    writeFile: makeFileWrites({
      store,
      reads,
      current: () => true,
      makeId: () => "save",
      write: () => Effect.never,
    }),
  });
  const target = {
    environmentId: EnvironmentId.make("mate"),
    input: { windowMs: 60_000, bucketMs: 1_000 },
  };
  try {
    await reads.sample("resourceTelemetryHistory", target);
    const result = registry.get(workspaceQuery("resourceTelemetryHistory")(target));
    expect(result).toMatchObject({
      _tag: "Failure",
      read: {
        fact: { kind: "unknown" },
        coverage: "unknown",
        refused: true,
        stream: {
          phase: "refused",
          fault: { outcome: "definitive-refusal", message: "History source refused." },
        },
      },
    });
    expect(AsyncResult.isAsyncResult(result)).toBe(true);
    const owner = registry.get(
      store.data.project(workspaceReading("resourceTelemetryHistory"), target),
    );
    expect(Object.hasOwn(owner.result, "read")).toBe(false);
  } finally {
    reads.close();
    vcs.close();
    store.close();
    registry.dispose();
  }
});

it("reading a checkout's Git status again asks its owner again after a refusal", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const reads = makeWorkspaceReads(store, { read: () => Effect.never });
  let subscriptions = 0;
  const vcs = makeVcsReads(store, () =>
    ++subscriptions === 1
      ? Stream.fail({ outcome: "definitive-refusal" as const, message: "Git status refused." })
      : Stream.concat(
          Stream.make({
            isRepo: false,
            hasPrimaryRemote: false,
            isDefaultRef: false,
            refName: null,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          }),
          Stream.never,
        ),
  );
  registry.set(workspaceHostAtom, {
    data: store.data,
    reads,
    vcs,
    act: makeWorkspaceActions({
      store,
      current: () => true,
      makeId: () => "action",
      mcpAnswer: reads.mcpAnswer,
      wire: { call: () => Effect.never },
    }),
    writeFile: makeFileWrites({
      store,
      reads,
      current: () => true,
      makeId: () => "save",
      write: () => Effect.never,
    }),
  });
  const status = vcsStatus({
    environmentId: EnvironmentId.make("mate"),
    input: { cwd: "/var/www/imgrun" },
  });
  const settled = (tag: "Failure" | "Success") =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (registry.get(status)._tag === tag) resolve();
      };
      registry.subscribe(status, check);
      check();
    });
  const unmount = registry.mount(status);
  try {
    await settled("Failure");
    registry.refresh(status);
    await settled("Success");
    expect(subscriptions).toBe(2);
    expect(registry.get(status)).toMatchObject({ _tag: "Success", value: { isRepo: false } });
  } finally {
    unmount();
    reads.close();
    vcs.close();
    store.close();
    registry.dispose();
  }
});

it("the MCP tab keeps showing its last list while it reads the servers again", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const answered: import("@t3tools/contracts").McpServersList = {
    servers: [],
    agents: [ProviderDriverKind.make("codex")],
  };
  let reads = 0;
  const workspaceReads = makeWorkspaceReads(store, {
    // The first read answers; the one a refresh sends never does (a slow Mate).
    read: () => (++reads === 1 ? Effect.succeed(answered) : Effect.never),
  } as Parameters<typeof makeWorkspaceReads>[1]);
  const vcs = makeVcsReads(store, () => Stream.never);
  registry.set(workspaceHostAtom, {
    data: store.data,
    reads: workspaceReads,
    vcs,
    act: makeWorkspaceActions({
      store,
      current: () => true,
      makeId: () => "action",
      mcpAnswer: workspaceReads.mcpAnswer,
      wire: { call: () => Effect.never },
    }),
    writeFile: makeFileWrites({
      store,
      reads: workspaceReads,
      current: () => true,
      makeId: () => "save",
      write: () => Effect.never,
    }),
  });
  const atom = workspaceQuery("mcp")({ environmentId: EnvironmentId.make("mate"), input: {} });
  const unmount = registry.mount(atom);
  try {
    await expect.poll(() => AsyncResult.value(registry.get(atom))._tag).toBe("Some");
    registry.refresh(atom);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(AsyncResult.value(registry.get(atom))).toMatchObject({ _tag: "Some", value: answered });
  } finally {
    unmount();
    workspaceReads.close();
    vcs.close();
    registry.dispose();
  }
});

it("a window focus that several views of the tools list answer reads it once", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let reads = 0;
  const workspaceReads = makeWorkspaceReads(store, {
    read: () =>
      Effect.sync(() => {
        reads += 1;
        return { servers: [], agents: [] } as never;
      }),
  });
  const vcs = makeVcsReads(store, () => Stream.never);
  registry.set(workspaceHostAtom, {
    data: store.data,
    reads: workspaceReads,
    vcs,
    act: makeWorkspaceActions({
      store,
      current: () => true,
      makeId: () => "action",
      mcpAnswer: workspaceReads.mcpAnswer,
      wire: { call: () => Effect.never },
    }),
    writeFile: makeFileWrites({
      store,
      reads: workspaceReads,
      current: () => true,
      makeId: () => "save",
      write: () => Effect.never,
    }),
  });
  const list = workspaceQuery("mcp")({ environmentId: EnvironmentId.make("mate"), input: {} });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const unmount = registry.mount(list);
  try {
    await settle();
    expect(reads).toBe(1);
    // The Tools tab, a proposal card and its docked copy each read again on focus.
    for (let view = 0; view < 3; view++) registry.refresh(list);
    await settle();
    expect(reads).toBe(2);
    expect(registry.get(list)).toMatchObject({ _tag: "Success" });
  } finally {
    unmount();
    workspaceReads.close();
    vcs.close();
    store.close();
    registry.dispose();
  }
});
