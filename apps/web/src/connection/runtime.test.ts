import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "../zerops/accountLifetime";
import { connectionAtomRuntime } from "./runtime";

const MINUTE_MS = 60_000;
const ORIGIN = "https://mate.example.test/zerops";

/** What the catalog's lifetime diagnostics say happened to it, in order. */
const catalogChanges = () =>
  mateDiagnostics
    .snapshot()
    .flatMap((entry) =>
      entry.kind === "catalog" && !("environmentId" in entry) ? [entry.change] : [],
    );

afterEach(() => {
  closeAccountLifetime();
  mateDiagnostics.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connectionAtomRuntime", () => {
  // The connection runtime lives for the post-grant stage, not for its readers (DESIGN §5 L4).
  it("the catalog survives a lapse and 5+ min with no ChatView", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    mateDiagnostics.enable();
    // The browser the connection platform listens to.
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: new URL(ORIGIN) }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    openAccountLifetime("user-1");
    mateDiagnostics.clear();
    const registry = AtomRegistry.make();
    const release = registry.mount(connectionAtomRuntime);
    await vi.advanceTimersByTimeAsync(0);
    expect(catalogChanges()).toEqual(["built"]);

    // The last view that read it goes away: a lapse, or a page with no conversation on it.
    release();
    await vi.advanceTimersByTimeAsync(6 * MINUTE_MS);
    expect(catalogChanges()).toEqual(["built"]);

    // Only the account's close disposes it (`rpc/atomRegistry.ts`).
    registry.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(catalogChanges()).toEqual(["built", "disposed"]);
  });
});
