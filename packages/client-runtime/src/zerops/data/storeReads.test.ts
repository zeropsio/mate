import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { Shown } from "../knowledge/known.ts";
import type { ZeropsServiceDeployedVersion } from "./deployedVersion.ts";
import type { ManagedZeropsDataRuntime } from "./runtime.ts";
import { readDeployedVersion, readMateFlagFromStore } from "./storeReads.ts";
import { service } from "./__fixtures__/index.ts";

/** A runtime whose store answers what the test writes; it counts every lease asked of it. */
function storeOf() {
  const version = Atom.make<Shown<ZeropsServiceDeployedVersion>>({
    state: "unread",
    waitingFor: null,
  });
  const flag = Atom.make<boolean | "unknown" | "unread">("unread");
  let leases = 0;
  const data = {
    reads: { deployedVersion: () => version, mateFlag: () => flag },
    acquire: () => {
      leases += 1;
      throw new Error("A store read takes no lease.");
    },
  } as unknown as ManagedZeropsDataRuntime;
  return { data, version, flag, atoms: AtomRegistry.make(), leases: () => leases };
}

const known = (value: ZeropsServiceDeployedVersion): Shown<ZeropsServiceDeployedVersion> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});

describe("what a service runs, asked once", () => {
  it("answers as the store states it, taking no lease", async () => {
    const store = storeOf();
    const answer = readDeployedVersion(store.data, store.atoms, service("s-1"));
    store.atoms.set(store.version, known({ activeId: "v-1", source: "CLI", name: "abc v1" }));
    await expect(answer).resolves.toEqual({ activeId: "v-1", source: "CLI", name: "abc v1" });
    expect(store.leases()).toBe(0);
  });

  it("gives up by its deadline when the store never says", async () => {
    const store = storeOf();
    await expect(
      readDeployedVersion(store.data, store.atoms, service("s-1"), undefined, 20),
    ).rejects.toThrow();
  });

  it("gives up when the store's statement failed for good", async () => {
    const store = storeOf();
    store.atoms.set(store.version, {
      state: "failed",
      failure: { kind: "transport", detail: "stream failed" },
      atMs: 0,
      attempt: 1,
      retryAtMs: null,
    });
    await expect(readDeployedVersion(store.data, store.atoms, service("s-1"))).rejects.toThrow();
  });
});

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
