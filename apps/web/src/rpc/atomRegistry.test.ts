import { Atom } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { appAtomRegistry, holdRegistryUntil, resetAppAtomRegistry } from "./atomRegistry";

describe("resetAppAtomRegistry", () => {
  it("gives the next account a fresh registry at once and disposes the old one after its teardowns", async () => {
    const closing = appAtomRegistry;
    const atom = Atom.keepAlive(Atom.make(1));
    closing.get(atom);
    let finish: () => void = () => {};
    holdRegistryUntil(new Promise<void>((resolve) => (finish = resolve)));

    resetAppAtomRegistry();
    expect(appAtomRegistry).not.toBe(closing);
    // A runtime shutting down still publishes its last state into the closing registry.
    expect(() => closing.set(atom, 2)).not.toThrow();

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(() => closing.set(atom, 3)).toThrow(/disposed/);
  });
});
