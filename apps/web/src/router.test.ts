import { describe, expect, it, vi } from "vite-plus/test";

import { type AppRouter, warmRouteChunks } from "./router";

/** A router as the warm-up reads it: its routes and the loader of their code. */
const routerOf = (
  routesById: Record<string, string>,
  loadRouteChunk: (route: unknown) => Promise<void>,
) =>
  ({ routesById, loadRouteChunk }) as unknown as Pick<AppRouter, "loadRouteChunk" | "routesById">;

describe("warmRouteChunks", () => {
  it("fetches every page's code once the boot has settled, and nothing before", () => {
    const loadRouteChunk = vi.fn((_route: unknown) => Promise.resolve());
    let later: (() => void) | undefined;
    warmRouteChunks(routerOf({ root: "root", a: "a", b: "b" }, loadRouteChunk), (run) => {
      later = run;
    });
    expect(loadRouteChunk).not.toHaveBeenCalled();
    later?.();
    expect(loadRouteChunk.mock.calls.map((call) => call[0])).toEqual(["root", "a", "b"]);
  });

  it("a page's code that fails to arrive is left to the navigation that needs it", async () => {
    const failed = Promise.reject(new Error("Failed to fetch dynamically imported module"));
    const loadRouteChunk = vi.fn((_route: unknown) => failed);
    warmRouteChunks(routerOf({ a: "a" }, loadRouteChunk), (run) => run());
    await expect(failed.catch(() => "left")).resolves.toBe("left");
    expect(loadRouteChunk).toHaveBeenCalledTimes(1);
  });
});
