import { expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { EnvironmentId, type ProjectReadFileResult } from "@t3tools/contracts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeWorkspaceReads, workspaceFailure, type WorkspaceWire } from "./mateWorkspace.ts";
import { workspaceReading } from "../projections/mateWorkspace.ts";
import { makeFileWrites } from "./mateFiles.ts";

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
function waitFor(store: ReturnType<typeof makeAccountStore>, ready: () => boolean) {
  return new Promise<void>((resolve) => {
    const stop = store.subscribe(() => check());
    const check = () => {
      if (ready()) {
        stop();
        resolve();
      }
    };
    check();
  });
}

// witness: packages/client-runtime/src/data/adapters/mateWorkspace.ts | if (closed) { → if (closed || streamOf(store.state(), scope).generation !== before) {
it("AD26: A file save stays pending until the Mate's later read-back holds its contents", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const reading = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<ProjectReadFileResult>();
  const reads = makeWorkspaceReads(store, {
    read: () =>
      Effect.promise(() => {
        reading.resolve();
        return answer.promise;
      }),
  } as WorkspaceWire);
  const write = makeFileWrites({
    store,
    reads,
    write: () => Effect.succeed({ relativePath: "a" }),
    current: () => true,
    makeId: () => "save",
  });
  try {
    const saving = write({
      environmentId: file.environmentId,
      input: { ...file.input, contents: "new" },
    });
    await Promise.race([reading.promise, saving]);
    expect(store.state().operations.get("save")?.receipt?.outcome.kind).toBe("pending");
    expect(snapshot(store)._tag).toBe("Initial");
    answer.resolve(value("new"));
    const result = await saving;
    expect(store.state().operations.get("save")?.receipt?.outcome.kind).toBe("succeeded");
    expect(result._tag).toBe("Success");
  } finally {
    answer.resolve(value("new"));
    reads.close();
    registry.dispose();
  }
});

// witness: packages/client-runtime/src/data/adapters/mateWorkspace.ts | "TimeoutError", → "Timeout",
it("AD27: A workspace action whose deadline was lost is uncertain, never the Mate's refusal", () => {
  expect(workspaceFailure({ _tag: "TimeoutError" }).outcome).toBe("transient");
});

// witness: packages/client-runtime/src/data/adapters/mateWorkspace.ts | answer.failure.outcome === "authoritative-denial" → answer.failure.outcome === "definitive-refusal"
it("AD28: A Git probe keeps the Mate's negative answer, and a refused read never invents one", async () => {
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
