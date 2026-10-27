import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { reactHookHarness as hooks } from "../../../web/src/test/reactHookHarness";

const runtime = vi.hoisted(() => ({
  context: null as unknown,
  read: null as unknown,
  release: vi.fn(),
  demand: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../../web/src/test/reactHookHarness");
  return {
    ...actual,
    useContext: () => runtime.context,
    useEffect: reactHookHarness.useEffect,
    useState: reactHookHarness.useState,
    useSyncExternalStore: reactHookHarness.useSyncExternalStore,
  };
});
import { useMateImageUri } from "./MateImages";

const readers: Reader[] = [];
class Reader {
  static readonly LOADING = 1;
  readyState = 0;
  result: string | null = null;
  onload: (() => void) | null = null;
  abort = vi.fn(() => {
    this.readyState = 2;
  });
  readAsDataURL(_blob: Blob) {
    this.readyState = 1;
    readers.push(this);
  }
  finish(uri: string) {
    this.readyState = 2;
    this.result = uri;
    this.onload?.();
  }
}
const key = {
  environmentId: EnvironmentId.make("mate"),
  resource: {
    _tag: "media-file" as const,
    threadId: ThreadId.make("thread"),
    path: "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  },
  rendition: "original" as const,
};
const render = (selected: typeof key | null = key) => {
  hooks.beginRender();
  return useMateImageUri(selected);
};
beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
  readers.length = 0;
  vi.stubGlobal("FileReader", Reader);
  runtime.read = { kind: "unknown" };
  runtime.demand.mockReturnValue(runtime.release);
  runtime.context = {
    data: { project: vi.fn(() => ({})) },
    registry: { get: () => runtime.read, subscribe: vi.fn() },
    images: { demand: runtime.demand },
  };
});
afterEach(() => {
  render(null);
  vi.unstubAllGlobals();
});

it("native presentations expose only the current authorized Blob and discard late reads after denial", () => {
  expect(render().uri).toBeNull();
  const first = new Blob(["first"]);
  runtime.read = { kind: "ready", blob: first };
  expect(render().uri).toBeNull();
  readers[0]!.finish("data:image/png;base64,Zmlyc3Q=");
  expect(render().uri).toBe("data:image/png;base64,Zmlyc3Q=");
  runtime.read = { kind: "ready", blob: new Blob(["second"]) };
  expect(render().uri).toBeNull();
  runtime.read = { kind: "failed", failure: "denied" };
  expect(render().uri).toBeNull();
  expect(readers[1]!.abort).toHaveBeenCalledOnce();
  readers[1]!.finish("data:image/png;base64,c2Vjb25k");
  expect(render().uri).toBeNull();
  expect(runtime.demand).toHaveBeenCalledOnce();
});
it("leaving an image releases its data-layer demand and aborts presentation conversion", () => {
  runtime.read = { kind: "ready", blob: new Blob(["original"]) };
  render();
  expect(render(null).uri).toBeNull();
  expect(runtime.release).toHaveBeenCalledOnce();
  expect(readers[0]!.abort).toHaveBeenCalledOnce();
  readers[0]!.finish("data:image/png;base64,b3JpZ2luYWw=");
  expect(render(null).uri).toBeNull();
});
