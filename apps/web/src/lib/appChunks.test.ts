import { describe, expect, it } from "vite-plus/test";

import { makeChunkWarmer } from "./appChunks";

/** A page whose idle slices the test runs by hand, and surfaces whose loads it records. */
function page() {
  const slices: Array<() => void> = [];
  const declared: Array<() => Promise<unknown>> = [];
  const loads: string[] = [];
  const surface = (name: string, options: { fails?: boolean; declares?: string } = {}) => {
    const load = async () => {
      loads.push(name);
      if (options.declares !== undefined) declared.push(surface(options.declares));
      if (options.fails === true)
        throw new TypeError("Failed to fetch dynamically imported module");
    };
    return load;
  };
  const warmer = makeChunkWarmer({ loaders: () => declared, idle: (then) => slices.push(then) });
  /** Runs idle slices until none is waiting, letting each load settle in between. */
  const settle = async () => {
    while (slices.length > 0) {
      slices.shift()!();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    }
  };
  return { declared, loads, surface, warmer, settle, slices };
}

describe("warming the app's surfaces", () => {
  it.each([
    {
      title: "every surface the app declared is loaded once, after the page settles",
      arrange: (p: ReturnType<typeof page>) => {
        p.declared.push(p.surface("Crew"), p.surface("Review"));
      },
      loads: ["Crew", "Review"],
    },
    {
      title: "a surface declared inside another one's code is loaded in the same pass",
      arrange: (p: ReturnType<typeof page>) => {
        p.declared.push(p.surface("Conversation", { declares: "Crew" }));
      },
      loads: ["Conversation", "Crew"],
    },
    {
      title: "a surface whose code is gone does not stop the others from loading",
      arrange: (p: ReturnType<typeof page>) => {
        p.declared.push(p.surface("Crew", { fails: true }), p.surface("Review"));
      },
      loads: ["Crew", "Review"],
    },
  ])("$title", async ({ arrange, loads }) => {
    const p = page();
    arrange(p);
    p.warmer.warm();
    await p.settle();
    expect(p.loads).toEqual(loads);
  });

  it("surfaces load one per idle slice, never all at once", async () => {
    const p = page();
    p.declared.push(p.surface("Crew"), p.surface("Review"), p.surface("Vault"));
    p.warmer.warm();
    expect(p.slices).toHaveLength(1);
    p.slices.shift()!();
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(p.loads).toEqual(["Crew"]);
    expect(p.slices).toHaveLength(1);
  });

  it("warming again loads only what was declared since", async () => {
    const p = page();
    p.declared.push(p.surface("Crew"));
    p.warmer.warm();
    await p.settle();
    p.declared.push(p.surface("Review"));
    p.warmer.warm();
    p.warmer.warm();
    await p.settle();
    expect(p.loads).toEqual(["Crew", "Review"]);
  });
});
