import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
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
import { workspaceCommand, workspaceHostAtom, workspaceQuery } from "./workspace";

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
