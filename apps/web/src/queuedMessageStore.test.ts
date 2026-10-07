import { beforeEach, describe, expect, it } from "vite-plus/test";

import { CommandId, MessageId } from "@t3tools/contracts";

import {
  drainGenerationOf,
  isQueuedMessageDue,
  queuedBubbleState,
  queuedSendAttemptIds,
  latestCompletedToolActivityId,
  useQueuedMessageStore,
  type QueuedComposerMessage,
} from "./queuedMessageStore";

function makeMessage(prompt: string): Omit<QueuedComposerMessage, "id"> {
  return {
    prompt,
    images: [],
    terminalContexts: [],
    reviewComments: [],
    submissionIntent: "foreground",
    queuedAfterToolActivityId: null,
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}

describe("queuedMessageStore", () => {
  beforeEach(() => {
    useQueuedMessageStore.setState({ queuesByThreadKey: {}, drainGenerationByThreadKey: {} });
  });

  it("keeps messages in submission order per thread", () => {
    const { enqueue } = useQueuedMessageStore.getState();
    enqueue("thread-a", makeMessage("first"));
    enqueue("thread-a", makeMessage("second"));
    enqueue("thread-b", makeMessage("other"));

    const queues = useQueuedMessageStore.getState().queuesByThreadKey;
    expect(queues["thread-a"]?.map((message) => message.prompt)).toEqual(["first", "second"]);
    expect(queues["thread-b"]?.map((message) => message.prompt)).toEqual(["other"]);
  });

  it("take hands the message to exactly one caller", () => {
    const { enqueue, take } = useQueuedMessageStore.getState();
    const entry = enqueue("thread-a", makeMessage("first"));

    expect(take("thread-a", entry.id, null)?.prompt).toBe("first");
    expect(take("thread-a", entry.id, null)).toBeNull();
    expect(useQueuedMessageStore.getState().queuesByThreadKey["thread-a"]).toBeUndefined();
  });

  it("take re-anchors the remaining messages to the current tool boundary", () => {
    const { enqueue, take } = useQueuedMessageStore.getState();
    const first = enqueue("thread-a", makeMessage("first"));
    enqueue("thread-a", makeMessage("second"));

    take("thread-a", first.id, "tool-2");

    const [second] = useQueuedMessageStore.getState().queuesByThreadKey["thread-a"] ?? [];
    expect(second?.queuedAfterToolActivityId).toBe("tool-2");
    expect(
      isQueuedMessageDue({ message: second!, phase: "running", latestToolActivityId: "tool-2" }),
    ).toBe(false);
  });

  it("remove keeps the other messages' anchors", () => {
    const { enqueue, remove } = useQueuedMessageStore.getState();
    const first = enqueue("thread-a", { ...makeMessage("first"), queuedAfterToolActivityId: "t1" });
    const second = enqueue("thread-a", makeMessage("second"));

    expect(remove("thread-a", second.id)?.prompt).toBe("second");
    expect(remove("thread-a", second.id)).toBeNull();
    expect(useQueuedMessageStore.getState().queuesByThreadKey["thread-a"]).toEqual([first]);
  });

  it("holdAtFront returns a failed message to the head, held", () => {
    const { enqueue, take, holdAtFront } = useQueuedMessageStore.getState();
    const first = enqueue("thread-a", makeMessage("first"));
    enqueue("thread-a", makeMessage("second"));
    const taken = take("thread-a", first.id, "t1")!;

    holdAtFront("thread-a", taken);

    const queue = useQueuedMessageStore.getState().queuesByThreadKey["thread-a"] ?? [];
    expect(queue.map((message) => message.prompt)).toEqual(["first", "second"]);
    expect(queue[0]?.holdUntilUserAction).toBe(true);
    expect(
      isQueuedMessageDue({ message: queue[0]!, phase: "ready", latestToolActivityId: null }),
    ).toBe(false);
  });

  it("drain empties one thread's queue in order", () => {
    const { enqueue, drain } = useQueuedMessageStore.getState();
    enqueue("thread-a", makeMessage("first"));
    enqueue("thread-a", makeMessage("second"));
    enqueue("thread-b", makeMessage("other"));

    expect(drain("thread-a").map((message) => message.prompt)).toEqual(["first", "second"]);
    expect(drainGenerationOf("thread-a")).toBe(1);
    expect(drain("thread-a")).toEqual([]);
    expect(drainGenerationOf("thread-a")).toBe(2);
    expect(useQueuedMessageStore.getState().queuesByThreadKey["thread-b"]).toHaveLength(1);
  });
});

describe("queued message dispatch timing", () => {
  const activities = [
    { id: "a1", kind: "tool.started", sequence: 1, createdAt: "2026-01-01T00:00:01Z" },
    { id: "a2", kind: "tool.completed", sequence: 2, createdAt: "2026-01-01T00:00:02Z" },
    { id: "a3", kind: "tool.updated", sequence: 3, createdAt: "2026-01-01T00:00:03Z" },
  ];

  it("finds the newest completed tool call by sequence, not position", () => {
    expect(latestCompletedToolActivityId(activities)).toBe("a2");
    expect(latestCompletedToolActivityId([])).toBeNull();
    expect(
      latestCompletedToolActivityId([
        { id: "late", kind: "tool.completed", sequence: 9, createdAt: "2026-01-01T00:00:09Z" },
        { id: "early", kind: "tool.completed", sequence: 4, createdAt: "2026-01-01T00:00:04Z" },
      ]),
    ).toBe("late");
  });

  it("waits mid-turn until a tool call finishes after the message was queued", () => {
    const message = { queuedAfterToolActivityId: "a2" };
    expect(isQueuedMessageDue({ message, phase: "running", latestToolActivityId: "a2" })).toBe(
      false,
    );
    expect(isQueuedMessageDue({ message, phase: "running", latestToolActivityId: "a4" })).toBe(
      true,
    );
  });

  it("never auto-sends a message held for user action", () => {
    const message = { queuedAfterToolActivityId: null, holdUntilUserAction: true };
    expect(isQueuedMessageDue({ message, phase: "ready", latestToolActivityId: "a4" })).toBe(false);
  });

  it("is due as soon as the turn is over, but not while a send is connecting", () => {
    const message = { queuedAfterToolActivityId: "a2" };
    expect(isQueuedMessageDue({ message, phase: "ready", latestToolActivityId: "a2" })).toBe(true);
    expect(isQueuedMessageDue({ message, phase: "connecting", latestToolActivityId: "a4" })).toBe(
      false,
    );
  });
});

// The owner, 2026-10-01: a turn ended and the queued follow-up never left — held after a send
// that failed for a moment, looking exactly like one still waiting. A send interrupted goes back
// unheld for the drain to retry; a send refused is held with its reason, which the bubble shows.
describe("a queued send that did not go", () => {
  beforeEach(() => {
    useQueuedMessageStore.setState({ queuesByThreadKey: {}, drainGenerationByThreadKey: {} });
  });

  it.each([
    {
      name: "held with its reason",
      reason: "Your sign-in could not be recorded." as string | undefined,
    },
    { name: "held by Stop, with none", reason: undefined },
  ])("$name: kept at the head, never due", ({ reason }) => {
    const store = useQueuedMessageStore.getState();
    const first = store.enqueue("t", makeMessage("first"));
    store.enqueue("t", makeMessage("second"));
    const taken = store.take("t", first.id, null)!;
    store.holdAtFront("t", taken, reason);
    const [head] = useQueuedMessageStore.getState().queuesByThreadKey.t!;
    expect(head?.id).toBe(first.id);
    expect(head?.heldReason).toBe(reason);
    expect(isQueuedMessageDue({ message: head!, phase: "ready", latestToolActivityId: null })).toBe(
      false,
    );
  });

  it("an interrupted send goes back to the head unheld, due again, counted", () => {
    const store = useQueuedMessageStore.getState();
    const first = store.enqueue("t", makeMessage("first"));
    store.enqueue("t", makeMessage("second"));
    const taken = store.take("t", first.id, null)!;
    store.requeueAtFront("t", taken);
    const [head, next] = useQueuedMessageStore.getState().queuesByThreadKey.t!;
    expect([head?.prompt, next?.prompt]).toEqual(["first", "second"]);
    expect(head?.holdUntilUserAction).toBeFalsy();
    expect(head?.heldReason).toBeUndefined();
    expect(head?.retries).toBe(1);
    expect(isQueuedMessageDue({ message: head!, phase: "ready", latestToolActivityId: null })).toBe(
      true,
    );
  });

  it("Retry takes the held message out, its hold and reason with it", () => {
    const store = useQueuedMessageStore.getState();
    const first = store.enqueue("t", makeMessage("first"));
    store.holdAtFront("t", store.take("t", first.id, null)!, "Refused.");
    const retried = useQueuedMessageStore.getState().release("t", first.id);
    expect(retried?.holdUntilUserAction).toBeFalsy();
    expect(retried?.heldReason).toBeUndefined();
    const [head] = useQueuedMessageStore.getState().queuesByThreadKey.t!;
    expect(head?.heldReason).toBeUndefined();
    expect(isQueuedMessageDue({ message: head!, phase: "ready", latestToolActivityId: null })).toBe(
      true,
    );
  });
});

describe("queuedBubbleState — what a queued bubble says", () => {
  const base = { ...makeMessage("x"), id: "m" };
  it.each([
    {
      name: "waiting, the next",
      input: { message: base, isNext: true, heldAhead: false, blockedByAnswer: false },
      line: null,
      send: { label: "Send now", retry: false, disabled: false },
    },
    {
      name: "held with its reason",
      input: {
        message: {
          ...base,
          holdUntilUserAction: true,
          heldReason: "Your sign-in could not be recorded.",
        },
        isNext: true,
        heldAhead: false,
        blockedByAnswer: false,
      },
      line: { text: "Your sign-in could not be recorded.", tone: "error" },
      send: { label: "Retry", retry: true, disabled: false },
    },
    {
      name: "held by Stop: the clock, waiting for Send now",
      input: {
        message: { ...base, holdUntilUserAction: true },
        isNext: true,
        heldAhead: false,
        blockedByAnswer: false,
      },
      line: null,
      send: { label: "Send now", retry: false, disabled: false },
    },
    {
      name: "behind a held one",
      input: { message: base, isNext: false, heldAhead: true, blockedByAnswer: false },
      line: { text: "Waits for the message above", tone: "muted" },
      send: { label: "Send now", retry: false, disabled: false },
    },
    {
      name: "the next, while a question waits on the person",
      input: { message: base, isNext: true, heldAhead: false, blockedByAnswer: true },
      line: { text: "Waits for your answer above", tone: "muted" },
      send: { label: "Waits for your answer above", retry: false, disabled: true },
    },
    {
      name: "held, while a question waits on the person: its reason, Retry after the answer",
      input: {
        message: { ...base, holdUntilUserAction: true, heldReason: "Refused." },
        isNext: true,
        heldAhead: false,
        blockedByAnswer: true,
      },
      line: { text: "Refused.", tone: "error" },
      send: { label: "Waits for your answer above", retry: true, disabled: true },
    },
  ] as const)("$name", ({ input, line, send }) => {
    const state = queuedBubbleState(input);
    expect(state.line).toEqual(line);
    expect(state.send).toEqual(send);
  });
});

// An interrupted send may have reached the server before its answer was lost: the retry goes
// with the same ids, which the server's command receipts take once. A person's Retry after a
// refusal goes with fresh ones, so a refusal the server remembers by id never comes back.
describe("the ids a queued send goes with", () => {
  const ids = { commandId: CommandId.make("command-1"), messageId: MessageId.make("message-1") };
  const fresh = { commandId: CommandId.make("command-2"), messageId: MessageId.make("message-2") };

  beforeEach(() => {
    useQueuedMessageStore.setState({ queuesByThreadKey: {}, drainGenerationByThreadKey: {} });
  });

  it("an interrupted send's ids stay with it; a person's Retry lets them go", () => {
    const store = useQueuedMessageStore.getState();
    const first = store.enqueue("t", makeMessage("first"));
    const taken = store.take("t", first.id, null)!;
    store.requeueAtFront("t", { ...taken, sendIds: ids });
    expect(useQueuedMessageStore.getState().queuesByThreadKey.t?.[0]?.sendIds).toEqual(ids);
    const again = useQueuedMessageStore.getState().take("t", first.id, null)!;
    useQueuedMessageStore.getState().holdAtFront("t", again, "Refused.");
    const retried = useQueuedMessageStore.getState().release("t", first.id);
    expect(retried?.sendIds).toBeUndefined();
    expect(useQueuedMessageStore.getState().queuesByThreadKey.t?.[0]?.sendIds).toBeUndefined();
  });

  it.each([
    { name: "the caller's own ids first", given: ids, stored: fresh, expected: ids },
    {
      name: "else the ids an interrupted attempt went with",
      given: undefined,
      stored: ids,
      expected: ids,
    },
    { name: "else fresh ones", given: undefined, stored: undefined, expected: fresh },
  ])("$name", ({ given, stored, expected }) => {
    expect(queuedSendAttemptIds({ given, stored, mint: () => fresh })).toEqual(expected);
  });
});
