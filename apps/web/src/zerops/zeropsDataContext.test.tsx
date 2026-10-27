import { describe, expect, it, vi } from "vite-plus/test";
import { Atom, AtomRegistry } from "effect/reactivity";

import { makeZeropsAtomSelectionStore } from "./zeropsDataContext";

describe("makeZeropsAtomSelectionStore", () => {
  it("reconciles a newer atom value when the first subscriber attaches", () => {
    const scheduled: Array<() => void> = [];
    const registry = AtomRegistry.make({
      scheduleTask: (task) => {
        let active = true;
        scheduled.push(() => {
          if (active) task();
        });
        return () => {
          active = false;
        };
      },
    });
    const source = Atom.make(0);
    const unmountSource = registry.mount(source);
    const projection = Atom.make((get) => get(source));
    const store = makeZeropsAtomSelectionStore(registry, [["value", projection]]);

    registry.set(source, 1);
    for (const task of scheduled.splice(0)) task();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    expect(store.getSnapshot().get("value")).toBe(1);
    expect(notifications).toBe(1);

    unsubscribe();
    unmountSource();
    registry.dispose();
  });

  // After a grant the data runtime lands every project's reads one microtask after another in
  // one task; the inventory hears each through this store, and React commits each it hears.
  it("tells its subscriber once per task, with the last value, however many of its atoms changed", async () => {
    const registry = AtomRegistry.make();
    const sources = Array.from({ length: 12 }, () => Atom.make(0));
    const unmounts = sources.map((source) => registry.mount(source));
    const store = makeZeropsAtomSelectionStore(
      registry,
      sources.map((source, index) => [`project-${index}`, source] as const),
    );
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    notifications = 0;

    for (let round = 1; round <= 4; round += 1) {
      for (const source of sources) {
        registry.set(source, round);
        await Promise.resolve();
      }
    }
    // The scheduled notification has delivered the final snapshot.
    await vi.waitFor(() => expect(notifications).toBeGreaterThan(0));

    expect(notifications).toBe(1);
    expect([...store.getSnapshot().values()]).toEqual(sources.map(() => 4));

    unsubscribe();
    for (const unmount of unmounts) unmount();
    registry.dispose();
  });
});
