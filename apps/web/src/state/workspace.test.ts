import { expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
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
import { workspaceCommand, workspaceHostAtom } from "./workspace";

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
