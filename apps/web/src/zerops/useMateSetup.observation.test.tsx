import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const source = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@t3tools/client-runtime/zerops/mateSetup", () => ({ readMateSetup: source.read }));
import { MATE_SETUP_POLL_MS, useMateSetup, type MateSetupObserved } from "./useMateSetup";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";

const trees: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
  closeAccountLifetime();
  source.read.mockReset();
  vi.useRealTimers();
});

const UNSETTLED = { at: "now", git: "done", runtimes: "running", standup: "waiting" } as const;

/** Mounts one reader of `origin`'s setup, and what it has seen. */
async function watch(origin = "https://mate.test"): Promise<Array<MateSetupObserved>> {
  const seen: Array<MateSetupObserved> = [];
  function View() {
    seen.push(useMateSetup(origin));
    return null;
  }
  await act(async () => {
    trees.push(create(createElement(View)));
  });
  return seen;
}

describe("one setup observation per Mate on screen", () => {
  it("shares one source read between the empty conversation and composer", async () => {
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue({
      kind: "setup",
      setup: { at: "now", git: "done", runtimes: "none", standup: "failed" },
    });
    const seen: Array<string | undefined> = [];
    function View() {
      seen.push(useMateSetup("https://mate.test").setup?.standup);
      return null;
    }
    await act(async () => {
      trees.push(create(createElement(View)), create(createElement(View)));
    });
    expect(source.read).toHaveBeenCalledOnce();
    expect(seen.at(-1)).toBe("failed");
  });
});

// A read that can't be the setup is a failure the view says, and the observation ends there: no
// timer reads it again. Only a read with nothing answering yet, or a setup still under way, is
// read again.
describe("what ends a setup observation", () => {
  it.each([
    { reading: { kind: "refused" }, failure: "refused", readsAgain: false },
    { reading: { kind: "invalid" }, failure: "invalid", readsAgain: false },
    { reading: { kind: "absent" }, failure: undefined, readsAgain: false },
    { reading: { kind: "unreachable" }, failure: undefined, readsAgain: true },
    { reading: { kind: "setup", setup: UNSETTLED }, failure: undefined, readsAgain: true },
  ] as const)("$reading.kind", async ({ reading, failure, readsAgain }) => {
    vi.useFakeTimers();
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue(reading);
    const seen = await watch();
    expect(seen.at(-1)?.failure).toBe(failure);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MATE_SETUP_POLL_MS * 5);
    });
    expect(source.read.mock.calls.length > 1).toBe(readsAgain);
  });

  it("keeps the last setup its Mate told through a failure that follows", async () => {
    vi.useFakeTimers();
    openAccountLifetime("setup-viewer");
    source.read
      .mockResolvedValueOnce({ kind: "setup", setup: UNSETTLED })
      .mockResolvedValue({ kind: "refused" });
    const seen = await watch();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MATE_SETUP_POLL_MS);
    });
    expect(seen.at(-1)).toEqual({ setup: UNSETTLED, failure: "refused" });
  });
});
