import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act, createElement, StrictMode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeAccountStore } from "@t3tools/client-runtime/data";
import { RegistryContext } from "@effect/atom-react";
import * as accountAdapters from "@t3tools/client-runtime/data";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  makeBrowserFrameDemand,
  MateBrowserFrames,
  useMateBrowserCallFrame,
  useMateBrowserStream,
} from "./browserStreamLinks.tsx";

const adapters = vi.hoisted(() => ({ start: vi.fn((_options: unknown) => ({ stop: vi.fn() })) }));
const ENV = EnvironmentId.make("mate");

describe("account browser stream demand", () => {
  it("the panel and card share one stream, closed after their last release", () => {
    const stop = vi.fn();
    const start = vi.fn(() => ({ stop }));
    const host = makeBrowserFrameDemand(start);
    const panel = host.hold(ENV);
    const card = host.hold(ENV);
    expect(start).toHaveBeenCalledTimes(1);
    panel();
    expect(stop).not.toHaveBeenCalled();
    card();
    card();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("sign-out closes demand before late releases and mounts", () => {
    const stop = vi.fn();
    const start = vi.fn(() => ({ stop }));
    const host = makeBrowserFrameDemand(start);
    const release = host.hold(ENV);
    host.close();
    host.hold(ENV)();
    release();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

function Browser() {
  useMateBrowserStream(ENV);
  return null;
}
function RunFrame() {
  useMateBrowserCallFrame(ENV, "call", true, "thread", "turn");
  return null;
}

describe("browser demands with an already resolved registry", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(accountAdapters, "makeMateBrowserFrameWire").mockReturnValue(
      {} as ReturnType<typeof accountAdapters.makeMateBrowserFrameWire>,
    );
    vi.spyOn(accountAdapters, "startMateBrowserFrames").mockImplementation(
      adapters.start as unknown as typeof accountAdapters.startMateBrowserFrames,
    );
    adapters.start.mockClear();
    openAccountLifetime("browser-test");
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it.each(
    [
      { name: "Browser", views: [Browser] },
      { name: "run frame", views: [RunFrame] },
      { name: "Browser and run frame together", views: [Browser, RunFrame] },
    ].flatMap((view) => [
      { ...view, end: "account close" },
      { ...view, end: "unmount" },
    ]),
  )("$name restarts after StrictMode cleanup and stops on $end", async ({ views, end }) => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const reader = AtomRegistry.make();
    const resolved = AsyncResult.success({});
    vi.spyOn(reader, "get").mockImplementation((() => resolved) as typeof reader.get);
    vi.spyOn(reader, "subscribe").mockImplementation(() => () => {});
    let tree: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        tree = create(
          createElement(
            StrictMode,
            null,
            createElement(
              RegistryContext.Provider,
              { value: reader },
              createElement(MateBrowserFrames, {
                store,
                children: views.map((View, key) => createElement(View, { key })),
              }),
            ),
          ),
        );
      });
      expect(adapters.start).toHaveBeenCalledTimes(2);
      const [first, remounted] = adapters.start.mock.results.map(({ value }) => value);
      expect(first.stop).toHaveBeenCalledTimes(1);
      expect(remounted.stop).not.toHaveBeenCalled();
      await act(async () => {
        if (end === "account close") closeAccountLifetime();
        tree?.unmount();
      });
      expect(remounted.stop).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => tree?.unmount());
      store.close();
      registry.dispose();
      reader.dispose();
    }
  });
});
