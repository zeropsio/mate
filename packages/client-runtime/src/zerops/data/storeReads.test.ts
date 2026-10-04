import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { ManagedZeropsDataRuntime } from "./runtime.ts";
import { readMateFlagFromStore } from "./storeReads.ts";
import { service } from "./__fixtures__/index.ts";

/** A runtime whose store answers what the test writes; it counts every lease asked of it. */
function storeOf() {
  const flag = Atom.make<boolean | "unknown" | "unread">("unread");
  let leases = 0;
  const data = {
    reads: { mateFlag: () => flag },
    acquire: () => {
      leases += 1;
      throw new Error("A store read takes no lease.");
    },
  } as unknown as ManagedZeropsDataRuntime;
  return { data, flag, atoms: AtomRegistry.make(), leases: () => leases };
}

describe("the Mate flag, asked once", () => {
  it("answers as the store states it, however often it is asked, taking no lease", async () => {
    const store = storeOf();
    store.atoms.set(store.flag, true);
    for (let asked = 0; asked < 20; asked++) {
      await expect(readMateFlagFromStore(store.data, store.atoms, service("s-1"))).resolves.toBe(
        true,
      );
    }
    expect(store.leases()).toBe(0);
  });

  it("is unknown by its deadline when the store never says", async () => {
    const store = storeOf();
    await expect(
      readMateFlagFromStore(store.data, store.atoms, service("s-1"), undefined, 20),
    ).resolves.toBe("unknown");
  });
});
