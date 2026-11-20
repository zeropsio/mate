import { describe, expect, it } from "vite-plus/test";

import {
  reviewQueueAfterPress,
  reviewQueueOrder,
  reviewQueueStart,
  reviewQueueView,
  reviewQueueWith,
  queuedKey,
  type QueuedTarget,
} from "./reviewQueue.logic";

const change = (number: number, repository = "appdev"): QueuedTarget => ({
  kind: "change",
  groupId: "tea",
  repository,
  number,
});
const keys = (targets: ReadonlyArray<QueuedTarget>) => targets.map(queuedKey);
const openOf = (...targets: ReadonlyArray<QueuedTarget>) => new Set(targets.map(queuedKey));

describe("review together: the queue's order", () => {
  it("reviews the oldest change first", () => {
    const order = reviewQueueOrder([
      { target: change(9) },
      { target: change(7) },
      { target: change(8) },
    ]);
    expect(keys(order)).toEqual(keys([change(7), change(8), change(9)]));
  });

  it("reviews a change only after the change it builds on, however old it is", () => {
    // #7 builds on #9: #8 is the oldest free to review, then #9, then #7 on top of it.
    const order = reviewQueueOrder([
      { target: change(7), buildsOn: [9] },
      { target: change(8) },
      { target: change(9) },
    ]);
    expect(keys(order)).toEqual(keys([change(8), change(9), change(7)]));
  });

  it("follows a chain of changes built on each other", () => {
    const order = reviewQueueOrder([
      { target: change(4), buildsOn: [6, 5] },
      { target: change(5), buildsOn: [6] },
      { target: change(6) },
    ]);
    expect(keys(order)).toEqual(keys([change(6), change(5), change(4)]));
  });

  it("reads what a change builds on in its own repository only", () => {
    const order = reviewQueueOrder([
      { target: change(2, "appdev"), buildsOn: [3] },
      { target: change(3, "apidev") },
    ]);
    expect(keys(order)).toEqual(keys([change(3, "apidev"), change(2, "appdev")]));
  });
});

describe("review together: moving through the queue", () => {
  const three = reviewQueueStart([change(7), change(8), change(9)]);

  it("says where the person stands: 1 of 3", () => {
    const view = reviewQueueView(three, openOf(change(7), change(8), change(9)));
    expect(view.words).toBe("1 of 3");
    expect(view.previous).toBeUndefined();
    expect(view.next).toEqual(change(8));
  });

  it("goes to the next and the previous change without merging", () => {
    const second = reviewQueueWith(three, { at: change(8), arrived: "next" });
    const view = reviewQueueView(second, openOf(change(7), change(8), change(9)));
    expect(view.words).toBe("2 of 3");
    expect(view.previous).toEqual(change(7));
    expect(view.next).toEqual(change(9));
  });

  it("moves to the next change after a merge, still counting the merged one", () => {
    const merged = reviewQueueWith(three, { done: { target: change(7), kind: "merged" } });
    const open = openOf(change(8), change(9));
    expect(reviewQueueAfterPress(merged, open)).toEqual(change(8));
    const moved = reviewQueueWith(merged, { at: change(8), arrived: "next" });
    expect(reviewQueueView(moved, open).words).toBe("2 of 3");
  });

  it("never moves on while the merged change's review shows something that waits on the person", () => {
    // The question after a project's first merge ("where should the code run") holds the queue
    // until it is answered or dismissed; an arrow still moves.
    const merged = reviewQueueWith(three, { done: { target: change(7), kind: "merged" } });
    const open = openOf(change(8), change(9));
    expect(reviewQueueAfterPress(merged, open, { waitsOnPerson: true })).toBeUndefined();
    expect(reviewQueueView(merged, open).next).toEqual(change(8));
    expect(reviewQueueAfterPress(merged, open, { waitsOnPerson: false })).toEqual(change(8));
  });

  it("comes back to a change the person skipped once the rest are merged", () => {
    const skipped = reviewQueueWith(reviewQueueWith(three, { at: change(9), arrived: "next" }), {
      done: { target: change(9), kind: "merged" },
    });
    const withFirst = reviewQueueWith(skipped, { done: { target: change(7), kind: "merged" } });
    expect(reviewQueueAfterPress(withFirst, openOf(change(8)))).toEqual(change(8));
  });

  it("ends after the last one and says what was merged", () => {
    let queue = three;
    for (const target of [change(7), change(8), change(9)]) {
      queue = reviewQueueWith(queue, { at: target, done: { target, kind: "merged" } });
    }
    expect(reviewQueueAfterPress(queue, openOf())).toBeUndefined();
    expect(reviewQueueView(queue, openOf()).words).toBe("#7, #8 and #9 merged");
  });

  it("says what was asked for, to a person who asks to merge", () => {
    let queue = reviewQueueStart([change(7), change(8)]);
    for (const target of [change(7), change(8)]) {
      queue = reviewQueueWith(queue, { at: target, done: { target, kind: "asked" } });
    }
    const open = openOf(change(7), change(8));
    expect(reviewQueueAfterPress(queue, open)).toBeUndefined();
    expect(reviewQueueView(queue, open).words).toBe("Asked to merge #7 and #8");
  });

  it("lets a change that settled elsewhere leave the queue quietly", () => {
    // #8 was merged by somebody else, or closed, or folded by its Mate: it is no longer open.
    const view = reviewQueueView(three, openOf(change(7), change(9)));
    expect(view.words).toBe("1 of 2");
    expect(view.next).toEqual(change(9));
    const merged = reviewQueueWith(three, { done: { target: change(7), kind: "merged" } });
    expect(reviewQueueAfterPress(merged, openOf(change(9)))).toEqual(change(9));
  });

  it("keeps the change on screen while it settles under the person's eyes", () => {
    const second = reviewQueueWith(three, { at: change(8), arrived: "next" });
    const view = reviewQueueView(second, openOf(change(7), change(9)));
    expect(view.words).toBe("2 of 3");
  });

  it("stays on a change whose merge was refused: nothing moves on by itself", () => {
    // A refusal records nothing done: there is no next press to follow.
    const view = reviewQueueView(three, openOf(change(7), change(8), change(9)));
    expect(view.done).toBe(false);
    expect(reviewQueueAfterPress(three, openOf(change(7), change(8), change(9)))).toBeUndefined();
  });

  it("keeps every change while the open changes are not read yet", () => {
    expect(reviewQueueView(three, undefined).words).toBe("1 of 3");
  });
});
