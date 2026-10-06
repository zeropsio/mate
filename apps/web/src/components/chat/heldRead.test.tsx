import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useHeld } from "./heldRead";

const EVERY = 1000;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Words {
  readonly words: string;
}

/** A held reader drawn as its conversation changes; what it read is what it drew last. */
function reader() {
  const reads: Words[] = [];
  function Probe({ live, hold, beat }: { live: Words; hold: boolean; beat: string }) {
    reads.push(useHeld(live, hold, beat, EVERY));
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  return {
    draw(words: string, { hold = true, beat = "turn-1 running" } = {}) {
      const live = { words };
      act(() => {
        const node = <Probe beat={beat} hold={hold} live={live} />;
        if (renderer === undefined) renderer = create(node);
        else renderer.update(node);
      });
      return live;
    },
    wait(ms: number) {
      act(() => vi.advanceTimersByTime(ms));
    },
    read: () => reads.at(-1)?.words,
    readValue: () => reads.at(-1),
    unmount: () => act(() => renderer?.unmount()),
  };
}

describe("useHeld", () => {
  it("live, it reads every change", () => {
    const page = reader();
    for (const words of ["a", "ab", "abc"]) {
      page.draw(words, { hold: false });
      expect(page.read()).toBe(words);
    }
    page.unmount();
  });

  // A run streaming in a Mate the person left: its words come many times a
  // second; the held list takes them about once a second, and the last always.
  it("held, it takes a burst of words at most once a wait, and the last one once the wait runs out", () => {
    const page = reader();
    page.draw("a");
    page.wait(EVERY);
    const drawnBefore: string[] = [];
    for (const words of ["ab", "abc", "abcd", "abcde"]) {
      page.draw(words);
      drawnBefore.push(page.read()!);
      page.wait(100);
    }
    // The first word after a quiet wait is taken in the same moment, after its
    // draw; the rest wait their turn.
    expect(drawnBefore).toEqual(["a", "ab", "ab", "ab"]);
    page.wait(EVERY);
    expect(page.read()).toBe("abcde");
    page.unmount();
  });

  it("held, it takes a turn starting or ending at once", () => {
    const page = reader();
    page.draw("a");
    page.draw("ab");
    expect(page.read()).toBe("a");
    page.draw("abc!", { beat: "turn-1 completed" });
    expect(page.read()).toBe("abc!");
    page.unmount();
  });

  it("let go, it catches up at once, and held again it holds from there", () => {
    const page = reader();
    page.draw("a");
    page.draw("ab");
    page.draw("abc", { hold: false });
    expect(page.read()).toBe("abc");
    page.draw("abcd");
    page.draw("abcde");
    expect(page.read()).toBe("abcd");
    page.unmount();
  });

  // The guarantee a kept list stands on: whatever streamed while it was out
  // of sight is what it holds a wait later, revealed by any way in.
  it("after any number of words, a wait later it holds exactly the live value", () => {
    const page = reader();
    let live = page.draw("");
    for (let index = 0; index < 37; index += 1) {
      live = page.draw("word ".repeat(index + 1));
      page.wait(40);
    }
    page.wait(EVERY);
    expect(page.readValue()).toBe(live);
    page.unmount();
  });

  it("holding still, it takes nothing again", () => {
    const page = reader();
    const live = { words: "a" };
    const reads: Words[] = [];
    function Same() {
      reads.push(useHeld(live, true, "b", EVERY));
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Same />);
    });
    const settled = reads.length;
    act(() => vi.advanceTimersByTime(EVERY * 5));
    expect(reads).toHaveLength(settled);
    expect(reads.at(-1)).toBe(live);
    act(() => renderer.unmount());
    page.unmount();
  });
});
