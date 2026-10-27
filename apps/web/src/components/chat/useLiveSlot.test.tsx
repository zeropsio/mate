import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SLOT_HOLD_MS, SLOT_MIN_SHOW_MS, slotHolds } from "./liveSlot.logic";
import { useLiveSlot } from "./useLiveSlot";

/** What the slot holds, as drawn. */
function Slot(props: {
  readonly live: ReadonlyArray<string>;
  readonly record: ReadonlyArray<string>;
  readonly final?: boolean;
  readonly syncing?: boolean;
  readonly onChange?: () => void;
}) {
  const slot = useLiveSlot({
    live: props.live,
    record: props.record,
    final: props.final ?? false,
    syncing: props.syncing ?? false,
    ...(props.onChange ? { onChange: props.onChange } : {}),
  });
  return <>{[...slotHolds(slot)].join(",")}</>;
}

describe("useLiveSlot — as drawn", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-04T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // The timeline's pace, 2026-10-04: an offer made from a layout effect
  // through an effect event ran the draw before's, and a change arriving in
  // the last draw was never heard. Each case below is offered once, in a
  // final draw, with nothing drawn after it.
  it("hears a call that goes live in the last draw", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Slot live={[]} record={[]} />);
    });
    act(() => {
      renderer.update(<Slot live={["step:a"]} record={["step:a"]} />);
    });
    expect(renderer.toJSON()).toBe("step:a");
  });

  it("lands what ended in the last draw once it has stood its minimum and its hold, telling the card", () => {
    const heard = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Slot live={["step:a"]} record={["step:a"]} onChange={heard} />);
    });
    act(() => {
      renderer.update(<Slot live={[]} record={["step:a"]} onChange={heard} />);
    });
    act(() => {
      vi.advanceTimersByTime(Math.max(SLOT_MIN_SHOW_MS, SLOT_HOLD_MS) + 50);
    });
    expect(renderer.toJSON()).toBeNull();
    expect(heard).toHaveBeenCalled();
  });

  it("lets everything into the history when the run is over in the last draw", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Slot live={["step:a"]} record={["step:a"]} />);
    });
    act(() => {
      renderer.update(<Slot final live={[]} record={["step:a"]} />);
    });
    expect(renderer.toJSON()).toBeNull();
  });

  // k27 item 5: a page in a background tab wakes its timers once a second at best, then once a
  // minute; a Mate working meanwhile left a backlog the card replayed one line at a time.
  it("shows at once what a turn did while the page was out of sight, as the person looks again", () => {
    const page = pageVisibility();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Slot live={["step:a"]} record={["step:a"]} />);
    });
    act(() => page.set("hidden"));
    const record = ["step:a", "step:b", "step:c", "step:d", "step:e"];
    act(() => {
      renderer.update(<Slot live={["step:f"]} record={record} />);
    });
    act(() => page.set("visible"));
    expect(renderer.toJSON()).toBe("step:f");
  });

  // k27 item 5: the draw that ends a catch-up — a conversation's first snapshot as its read ends,
  // a kept conversation shown again with what arrived while it was away — swaps in lines nobody
  // watched arrive, in the same draw that says it is watched again.
  const catchUp = (before: ReadonlyArray<string>) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Slot syncing live={["step:a"]} record={before} />);
    });
    act(() => {
      renderer.update(<Slot live={["step:e"]} record={["step:a", "step:b", "step:c", "step:d"]} />);
    });
    return renderer.toJSON();
  };

  it("a conversation opened mid-turn shows every event already received at once", () => {
    // Its read ends in the draw its first snapshot lands in.
    expect(catchUp([])).toBe("step:e");
  });

  it("a kept conversation switched back to shows at once what arrived while it was out of sight", () => {
    expect(catchUp(["step:a"])).toBe("step:e");
  });
});

/** A page whose visibility the test sets, heard as a browser tells it. */
function pageVisibility() {
  let state: DocumentVisibilityState = "visible";
  const heard = new Set<() => void>();
  vi.stubGlobal("document", {
    get visibilityState() {
      return state;
    },
    addEventListener: (_: string, listener: () => void) => heard.add(listener),
    removeEventListener: (_: string, listener: () => void) => heard.delete(listener),
  });
  return {
    set(next: DocumentVisibilityState) {
      state = next;
      for (const listener of heard) listener();
    },
  };
}
