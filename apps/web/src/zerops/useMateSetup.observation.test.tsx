import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const source = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@t3tools/client-runtime/zerops/mateSetup", () => ({ readMateSetup: source.read }));
import { useMateSetup } from "./useMateSetup";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";

const trees: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
  closeAccountLifetime();
  source.read.mockReset();
});
describe("one setup observation per Mate on screen", () => {
  it("shares one source read between the empty conversation and composer", async () => {
    openAccountLifetime("setup-viewer");
    source.read.mockResolvedValue({
      kind: "setup",
      setup: { at: "now", git: "done", runtimes: "none", standup: "failed" },
    });
    const seen: Array<string | undefined> = [];
    function View() {
      seen.push(useMateSetup("https://mate.test")?.standup);
      return null;
    }
    await act(async () => {
      trees.push(create(createElement(View)), create(createElement(View)));
    });
    expect(source.read).toHaveBeenCalledOnce();
    expect(seen.at(-1)).toBe("failed");
  });
});
