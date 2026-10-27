import { describe, expect, it } from "vite-plus/test";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";
import { EnvironmentId, type VcsStatusResult } from "@t3tools/contracts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { mateVcs, type VcsKey } from "../projections/mateVcs.ts";
import type { StreamFault } from "../streamMachine.ts";
import { makeVcsReads } from "./mateVcs.ts";

const target: VcsKey = { environmentId: EnvironmentId.make("env"), input: { cwd: "/var/www/api" } };
const status: VcsStatusResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: true,
  refName: "main",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};
const read = (store: ReturnType<typeof makeAccountStore>) =>
  mateVcs.derive(readsOfState(store.state()), target);
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

describe("a checkout's Git status", () => {
  it("refused, is asked of its owner again when read again; live, is left as it is", async () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    let subscriptions = 0;
    const reads = makeVcsReads(store, () =>
      ++subscriptions === 1
        ? Stream.fail({
            outcome: "definitive-refusal",
            message: "Git command failed in GitVcsDriver.statusDetails.status.",
          } satisfies StreamFault)
        : Stream.concat(Stream.make(status), Stream.never),
    );
    const view = reads.demand(target);
    await waitFor(store, () => read(store)._tag === "Failure");

    reads.again(target);
    await waitFor(store, () => read(store)._tag === "Success");
    expect(subscriptions).toBe(2);
    expect(read(store)).toMatchObject({ _tag: "Success", value: status });

    reads.again(target);
    expect(subscriptions, "a live status hears every change already").toBe(2);
    view();
    reads.close();
    registry.dispose();
  });
});
