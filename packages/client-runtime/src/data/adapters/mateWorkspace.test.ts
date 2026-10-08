import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { EnvironmentId, type ProjectReadFileResult } from "@t3tools/contracts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeWorkspaceReads, workspaceFailure, type WorkspaceWire } from "./mateWorkspace.ts";
import { workspaceReading } from "../projections/mateWorkspace.ts";
import { workspaceScope } from "../families/mateWorkspace.ts";
import { makeFileWrites } from "./mateFiles.ts";
import { makeWorkspaceActions } from "./mateWorkspaceActions.ts";
import type { WorkspaceMutationWire } from "../operations/executors/mateWorkspace.ts";

const file = {
  environmentId: EnvironmentId.make("env"),
  input: { cwd: "/repo", relativePath: "a" },
};
const value = (contents: string): ProjectReadFileResult => ({
  relativePath: "a",
  contents,
  byteLength: contents.length,
  truncated: false,
});
const snapshot = (store: ReturnType<typeof makeAccountStore>) =>
  workspaceReading("file").derive(readsOfState(store.state()), file).result;
const wire = (
  read: () => Effect.Effect<ProjectReadFileResult, import("../streamMachine.ts").StreamFault>,
): WorkspaceWire => ({ read: () => read() }) as WorkspaceWire;
function waitFor(store: ReturnType<typeof makeAccountStore>, test: () => boolean) {
  return new Promise<void>((resolve) => {
    const stop = store.subscribe(() => check());
    const check = () => {
      if (test()) {
        stop();
        resolve();
      }
    };
    check();
  });
}
describe("workspace owner reads and saves", () => {
  it("shares demand and retains the prior file through a failed reread", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let calls = 0;
    const reads = makeWorkspaceReads(
      store,
      wire(() =>
        ++calls === 1
          ? Effect.succeed(value("owner"))
          : Effect.fail({ outcome: "definitive-refusal", message: "Read refused." }),
      ),
    );
    expect(snapshot(store)._tag).toBe("Initial");
    const done = waitFor(store, () => snapshot(store)._tag === "Success");
    const a = reads.demand("file", file);
    const b = reads.demand("file", file);
    await done;
    expect(calls).toBe(1);
    a();
    const failed = waitFor(store, () => snapshot(store)._tag === "Failure");
    reads.again("file", file);
    await failed;
    const result = snapshot(store);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(result.previousSuccess).toMatchObject({
        _tag: "Some",
        value: { value: value("owner") },
      });
    b();
    reads.close();
    registry.dispose();
  });
  it("does not revive a refused file on remount, but an explicit retry asks its owner", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let calls = 0;
    const reads = makeWorkspaceReads(
      store,
      wire(() => {
        calls++;
        return Effect.fail({ outcome: "definitive-refusal", message: "Read refused." });
      }),
    );
    const failed = waitFor(store, () => snapshot(store)._tag === "Failure");
    const release = reads.demand("file", file);
    await failed;
    release();
    const again = reads.demand("file", file);
    expect(calls).toBe(1);
    const retry = waitFor(store, () => calls === 2 && snapshot(store)._tag === "Failure");
    reads.again("file", file);
    await retry;
    again();
    reads.close();
    registry.dispose();
  });
  it("keeps a save pending until its later owner read-back confirms the contents", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let reply!: (value: ProjectReadFileResult) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const reads = makeWorkspaceReads(
      store,
      wire(() =>
        Effect.promise(() => {
          started();
          return new Promise((resolve) => {
            reply = resolve;
          });
        }),
      ),
    );
    const write = makeFileWrites({
      store,
      reads,
      write: () => Effect.succeed({ relativePath: "a" }),
      current: () => true,
      makeId: () => "save",
    });
    const saving = write({
      environmentId: file.environmentId,
      input: { ...file.input, contents: "new" },
    });
    await reading;
    expect(store.state().operations.get("save")?.receipt?.outcome.kind).toBe("pending");
    expect(snapshot(store)._tag).toBe("Initial");
    reply(value("new"));
    expect((await saving)._tag).toBe("Success");
    expect(store.state().operations.get("save")?.receipt?.outcome.kind).toBe("succeeded");
    reads.close();
    registry.dispose();
  });
  it("does not resend an uncertain save or pretend a mismatching read-back succeeded", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let writes = 0;
    const reads = makeWorkspaceReads(
      store,
      wire(() => Effect.succeed(value("owner"))),
    );
    const write = makeFileWrites({
      store,
      reads,
      write: () => {
        writes++;
        return Effect.fail({ outcome: "transient", message: "Lost answer." } as const);
      },
      current: () => true,
      makeId: () => "save",
    });
    const result = await write({
      environmentId: file.environmentId,
      input: { ...file.input, contents: "new" },
    });
    expect(result._tag).toBe("Failure");
    expect(writes).toBe(1);
    await write({ environmentId: file.environmentId, input: { ...file.input, contents: "new" } });
    expect(writes).toBe(1);
    expect(store.state().operations.get("save")?.submission).toBe("uncertain-unasked");
    expect(store.state().operations.get("save")?.unresolved?.nextAction).toContain("Read the file");
    reads.close();
    registry.dispose();
  });
  it("fences an older file answer after a fresh request supersedes it", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let reply!: (value: ProjectReadFileResult) => void;
    let started!: () => void;
    let calls = 0;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const reads = makeWorkspaceReads(
      store,
      wire(() =>
        ++calls === 1
          ? Effect.promise(() => {
              started();
              return new Promise((resolve) => {
                reply = resolve;
              });
            })
          : Effect.succeed(value("new")),
      ),
    );
    const release = reads.demand("file", file);
    await reading;
    const finished = waitFor(store, () => snapshot(store)._tag === "Success");
    reads.again("file", file);
    reply(value("old"));
    await finished;
    expect(snapshot(store)).toMatchObject({ _tag: "Success", value: value("new") });
    release();
    reads.close();
    registry.dispose();
  });
  it("keeps coverage unknown until an owner answer, including authoritative empty content", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    expect(readsOfState(store.state()).coverage(workspaceScope("file", file))).toBe("unknown");
    const reads = makeWorkspaceReads(
      store,
      wire(() => Effect.succeed(value(""))),
    );
    const result = await reads.sample("file", file);
    expect(result).toMatchObject({ _tag: "Success", value: value("") });
    expect(readsOfState(store.state()).coverage(workspaceScope("file", file))).toBe("complete");
    reads.close();
    registry.dispose();
  });
});

describe("signed URL owner lifetime", () => {
  it("refreshes at expiresAt, withholds the expired address, and cancels demand on close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const target = {
      environmentId: EnvironmentId.make("env"),
      input: {
        resource: { _tag: "project-favicon" as const, cwd: "/repo" },
      },
    };
    let calls = 0;
    const expiresAt = 900;
    const reads = makeWorkspaceReads(store, {
      read: () => {
        calls++;
        return calls === 1
          ? Effect.succeed({ relativeUrl: "/signed/first", expiresAt })
          : Effect.never;
      },
    } as WorkspaceWire);
    const read = () =>
      workspaceReading("assetUrl").derive(readsOfState(store.state()), target).result;
    try {
      const done = waitFor(store, () => read()._tag === "Success");
      const release = reads.demand("assetUrl", target);
      await done;
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(899);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(read()._tag).toBe("Initial");
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toBe(2);
      release();
      reads.close();
      await vi.runAllTimersAsync();
      expect(calls).toBe(2);
    } finally {
      reads.close();
      registry.dispose();
      vi.useRealTimers();
    }
  });
});

it("keeps the MCP action's owner answer when an older list finishes later", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const target = { environmentId: file.environmentId, input: {} };
  let reply!: (value: import("@t3tools/contracts").McpServersList) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const reads = makeWorkspaceReads(store, {
    read: () =>
      Effect.promise(() => {
        entered();
        return new Promise<import("@t3tools/contracts").McpServersList>((resolve) => {
          reply = resolve;
        });
      }),
  } as WorkspaceWire);
  const release = reads.demand("mcp", target);
  await started;
  const fresh = { agents: ["codex" as const], servers: [] };
  const act = makeWorkspaceActions({
    store,
    current: () => true,
    makeId: () => "mcp-change",
    mcpAnswer: reads.mcpAnswer,
    wire: { call: () => Effect.succeed(fresh) } as WorkspaceMutationWire,
  });
  expect(
    (await act("mate-mcp-remove", { environmentId: file.environmentId, input: { name: "old" } }))
      ._tag,
  ).toBe("Success");
  reply({ agents: [], servers: [] });
  // A promise barrier lets the obsolete owner answer reach its generation fence.
  await Promise.resolve();
  await Promise.resolve();
  expect(workspaceReading("mcp").derive(readsOfState(store.state()), target).result).toMatchObject({
    _tag: "Success",
    value: fresh,
  });
  release();
  reads.close();
  registry.dispose();
});

it("does not reuse an expired URL after remount", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const target = {
    environmentId: file.environmentId,
    input: { resource: { _tag: "project-favicon" as const, cwd: "/repo" } },
  };
  let calls = 0;
  const reads = makeWorkspaceReads(store, {
    read: () =>
      ++calls === 1 ? Effect.succeed({ relativeUrl: "/signed", expiresAt: 900 }) : Effect.never,
  } as WorkspaceWire);
  const read = () =>
    workspaceReading("assetUrl").derive(readsOfState(store.state()), target).result;
  try {
    const done = waitFor(store, () => read()._tag === "Success");
    const release = reads.demand("assetUrl", target);
    await done;
    release();
    await vi.advanceTimersByTimeAsync(901);
    expect(calls).toBe(1);
    const remount = reads.demand("assetUrl", target);
    expect(read()._tag).toBe("Initial");
    remount();
  } finally {
    reads.close();
    registry.dispose();
    vi.useRealTimers();
  }
});

it("a lost action deadline is uncertain, never a source refusal", () => {
  expect(workspaceFailure({ _tag: "TimeoutError" }).outcome).toBe("transient");
});

it("account close releases a pending read even after the store's listeners have ended", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const reads = makeWorkspaceReads(
    store,
    wire(() => Effect.sync(entered).pipe(Effect.andThen(Effect.never))),
  );
  const pending = reads.sample("file", file);
  await started;
  store.close();
  reads.close();
  expect(await pending).toMatchObject({ _tag: "Failure" });
  registry.dispose();
});

it("an explicit retry supersedes an older denial instead of losing the new owner read", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let deny!: () => void;
  let answer!: (value: ProjectReadFileResult) => void;
  let first!: () => void;
  let next!: () => void;
  const entered = new Promise<void>((resolve) => {
    first = resolve;
  });
  const restarted = new Promise<void>((resolve) => {
    next = resolve;
  });
  let calls = 0;
  const reads = makeWorkspaceReads(
    store,
    wire(() =>
      ++calls === 1
        ? Effect.callback((resume) => {
            first();
            deny = () =>
              resume(
                Effect.fail({ outcome: "authoritative-denial", message: "Old grant denied." }),
              );
          })
        : Effect.promise(() => {
            next();
            return new Promise<ProjectReadFileResult>((resolve) => {
              answer = resolve;
            });
          }),
    ),
  );
  const release = reads.demand("file", file);
  await entered;
  reads.again("file", file);
  deny();
  await restarted;
  expect(snapshot(store)._tag).toBe("Initial");
  const done = waitFor(store, () => snapshot(store)._tag === "Success");
  answer(value("new grant"));
  await done;
  expect(snapshot(store)).toMatchObject({ _tag: "Success", value: value("new grant") });
  release();
  reads.close();
  registry.dispose();
});

it("an MCP action's owner answer clears the prior list refusal", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const target = { environmentId: file.environmentId, input: {} };
  const reads = makeWorkspaceReads(store, {
    read: () =>
      Effect.fail({ outcome: "definitive-refusal", message: "Unavailable before setup." }),
  });
  expect((await reads.sample("mcp", target))._tag).toBe("Failure");
  const fresh = { agents: ["codex" as const], servers: [] };
  const act = makeWorkspaceActions({
    store,
    current: () => true,
    makeId: () => "mcp-setup",
    mcpAnswer: reads.mcpAnswer,
    wire: { call: () => Effect.succeed(fresh) } as WorkspaceMutationWire,
  });
  await act("mate-mcp-remove", { environmentId: file.environmentId, input: { name: "old" } });
  expect(workspaceReading("mcp").derive(readsOfState(store.state()), target).result).toMatchObject({
    _tag: "Success",
    value: fresh,
  });
  reads.close();
  registry.dispose();
});

it("a Git probe retains the owner's negative, while a refused read never invents one", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const target = { environmentId: EnvironmentId.make("env"), input: { cwd: "/repo" } };
  const read = () =>
    workspaceReading("gitRemote").derive(readsOfState(store.state()), target).result;
  let refused = false;
  const reads = makeWorkspaceReads(store, {
    read: () =>
      refused
        ? Effect.fail({ outcome: "definitive-refusal", message: "Probe unavailable." })
        : Effect.succeed({
            reachable: false,
            remote: "origin",
            refCount: 0,
            detail: "Access refused.",
          }),
  } as WorkspaceWire);
  const done = waitFor(store, () => read()._tag === "Success");
  const release = reads.demand("gitRemote", target);
  await done;
  expect(read()).toMatchObject({ value: { reachable: false } });
  release();
  const again = reads.demand("gitRemote", target);
  expect(read()).toMatchObject({ value: { reachable: false } });
  refused = true;
  const failed = waitFor(store, () => read()._tag === "Failure");
  reads.again("gitRemote", target);
  await failed;
  expect(read()).toMatchObject({
    _tag: "Failure",
    previousSuccess: { value: { value: { reachable: false } } },
  });
  again();
  reads.close();
  registry.dispose();
});
