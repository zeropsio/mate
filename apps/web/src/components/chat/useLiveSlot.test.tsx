import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SLOT_MIN_SHOW_MS, slotHolds } from "./liveSlot.logic";
import { useLiveSlot } from "./useLiveSlot";

/** What the slot holds, as drawn. */
function Slot(props: {
  readonly live: ReadonlyArray<string>;
  readonly record: ReadonlyArray<string>;
  readonly final?: boolean;
  readonly onChange?: () => void;
}) {
  const slot = useLiveSlot({
    live: props.live,
    record: props.record,
    final: props.final ?? false,
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

  it("lands what ended in the last draw once it has stood its minimum, telling the card", () => {
    const heard = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Slot live={["step:a"]} record={["step:a"]} onChange={heard} />);
    });
    act(() => {
      renderer.update(<Slot live={[]} record={["step:a"]} onChange={heard} />);
    });
    act(() => {
      vi.advanceTimersByTime(SLOT_MIN_SHOW_MS + 50);
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
});
