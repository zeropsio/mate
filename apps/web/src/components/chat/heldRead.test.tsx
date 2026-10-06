import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useHeld } from "./heldRead";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Step {
  readonly live: { readonly words: string };
  readonly hold: boolean;
  readonly beat: string;
}

function Probe({ step, seen }: { readonly step: Step; readonly seen: Array<string> }) {
  const value = useHeld(step.live, step.hold, step.beat);
  seen.push(value.words);
  return null;
}

/** What each draw read, its last pass, through the steps. */
async function readThrough(steps: ReadonlyArray<Step>) {
  const read: string[] = [];
  let renderer: ReactTestRenderer | undefined;
  for (const step of steps) {
    const seen: string[] = [];
    await act(() => {
      if (renderer === undefined) renderer = create(<Probe seen={seen} step={step} />);
      else renderer.update(<Probe seen={seen} step={step} />);
    });
    read.push(seen.at(-1)!);
  }
  await act(() => renderer?.unmount());
  return read;
}

const at = (words: string, hold: boolean, beat = "turn-1 running"): Step => ({
  live: { words },
  hold,
  beat,
});

describe("useHeld", () => {
  it.each([
    {
      name: "live, it reads every change",
      steps: [at("a", false), at("ab", false), at("abc", false)],
      read: ["a", "ab", "abc"],
    },
    {
      name: "held, it keeps what stood as the hold began through the turn's words",
      steps: [at("a", false), at("ab", true), at("abc", true), at("abcd", true)],
      read: ["a", "ab", "ab", "ab"],
    },
    {
      name: "held, it takes the turn's end",
      steps: [at("a", true), at("ab", true), at("abc!", true, "turn-1 completed")],
      read: ["a", "a", "abc!"],
    },
    {
      name: "let go, it catches up at once",
      steps: [at("a", true), at("ab", true), at("abc", false), at("abcd", false)],
      read: ["a", "a", "abc", "abcd"],
    },
    {
      name: "held again, it holds from where it was let go",
      steps: [at("a", true), at("ab", false), at("abc", true), at("abcd", true)],
      read: ["a", "ab", "abc", "abc"],
    },
  ])("$name", async ({ steps, read }) => {
    expect(await readThrough(steps)).toEqual(read);
  });

  it("hands back the very value it holds, so nothing derived from it is derived again", async () => {
    const live = { words: "a" };
    const values: unknown[] = [];
    function Same({ step }: { readonly step: Step }) {
      values.push(useHeld(step.live, step.hold, step.beat));
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    await act(() => {
      renderer = create(<Same step={{ live, hold: true, beat: "b" }} />);
    });
    await act(() =>
      renderer!.update(<Same step={{ live: { words: "ab" }, hold: true, beat: "b" }} />),
    );
    expect(values.at(-1)).toBe(live);
    await act(() => renderer?.unmount());
  });
});
