import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ModelSelection,
} from "@t3tools/contracts";
import { makeAccountStore, makeSendTurnReceipts } from "@t3tools/client-runtime/data";
import * as Cause from "effect/Cause";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  beginQueuedSend,
  settleQueuedSend,
  useQueuedMessageStore,
  type QueuedComposerMessage,
  type QueuedMessageSendSettings,
} from "../../queuedMessageStore";
import type { Thread } from "../../types";
import {
  backgroundQueuedMessageDue,
  sendQueuedMessageInBackground,
  turnSendAsk,
  type BackgroundQueuedSendDeps,
} from "./queuedMessageSender.logic";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");
const threadKey = "env-1:thread-1";
const now = "2026-10-07T10:00:00.000Z";
const sonnet: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-sonnet-4-6",
};
const opus: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-4-6",
};

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    environmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: sonnet,
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

const session = (status: "running" | "ready") => ({
  threadId,
  status,
  providerName: "claudeAgent",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  runtimeMode: "full-access" as const,
  activeTurnId: status === "running" ? TurnId.make("turn-1") : null,
  lastError: null,
  updatedAt: now,
});
const runningThread = makeThread({ session: session("running") });
const endedThread = makeThread({
  session: session("ready"),
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: "2026-10-07T10:01:00.000Z",
    assistantMessageId: null,
  },
});

const settings: QueuedMessageSendSettings = {
  modelSelection: sonnet,
  runtimeMode: "full-access",
  interactionMode: "default",
  promptEffort: null,
};

function queue(
  prompt: string,
  overrides: Partial<Omit<QueuedComposerMessage, "id">> = {},
): QueuedComposerMessage {
  return useQueuedMessageStore.getState().enqueue(threadKey, {
    prompt,
    images: [],
    files: [],
    terminalContexts: [],
    reviewComments: [],
    submissionIntent: "foreground",
    sendSettings: settings,
    queuedAfterToolActivityId: null,
    createdAt: now,
    ...overrides,
  });
}

const ok = () => Promise.resolve(AsyncResult.success(undefined));

function makeDeps(
  thread: Thread,
  overrides: Partial<BackgroundQueuedSendDeps> = {},
): BackgroundQueuedSendDeps {
  return {
    readThread: () => thread,
    supportsAttachmentUploads: true,
    uploads: {
      start: vi.fn(),
      settle: () => Promise.resolve(),
      uploaded: () => [],
      release: vi.fn(),
    },
    readDataUrl: () => Promise.resolve("data:"),
    updateMetadata: vi.fn(ok),
    setRuntimeMode: vi.fn(ok),
    setInteractionMode: vi.fn(ok),
    startTurn: vi.fn(ok),
    sendCrew: vi.fn(ok),
    mintIds: () => ({
      commandId: CommandId.make("command-1"),
      messageId: MessageId.make("message-1"),
    }),
    receipts: null,
    ...overrides,
  };
}

const queued = () => useQueuedMessageStore.getState().queuesByThreadKey[threadKey] ?? [];

describe("backgroundQueuedMessageDue", () => {
  beforeEach(() => {
    useQueuedMessageStore.setState({
      queuesByThreadKey: {},
      drainGenerationByThreadKey: {},
      openThreadKeys: {},
      queuedSendByThreadKey: {},
    });
  });

  const base = {
    open: false,
    thread: endedThread,
    threadLive: true,
    connected: true,
    serverConfigKnown: true,
    pendingRequest: false,
    send: undefined,
  };

  it.each([
    ["a queued message of a conversation not on screen goes when its turn ends", {}, true],
    ["an open conversation sends its own queue", { open: true }, false],
    [
      "nothing goes while the turn still runs and no tool call finished",
      { thread: runningThread },
      false,
    ],
    [
      "nothing goes while a question or an approval waits on the person",
      { pendingRequest: true },
      false,
    ],
    ["nothing goes while its Mate is not connected", { connected: false }, false],
    ["nothing goes before its thread has loaded", { threadLive: false }, false],
    ["nothing goes before its Mate's capabilities are known", { serverConfigKnown: false }, false],
    [
      "the next message waits while the one before it prepares",
      { send: { phase: "preparing" as const } },
      false,
    ],
  ])("%s", (_sentence, overrides, due) => {
    const next = queue("next");
    expect(backgroundQueuedMessageDue({ ...base, next, ...overrides })).toBe(due);
  });

  it("goes mid-turn once a tool call finished after it was queued", () => {
    const next = queue("next");
    const afterTool = makeThread({
      session: session("running"),
      activities: [
        {
          id: "tool-1",
          kind: "tool.completed",
          tone: "tool",
          summary: "Read",
          payload: {},
          turnId: TurnId.make("turn-1"),
          createdAt: now,
        } as unknown as Thread["activities"][number],
      ],
    });
    expect(backgroundQueuedMessageDue({ ...base, thread: afterTool, next })).toBe(true);
  });

  it("the next message waits until the server picks up the one before it", () => {
    const next = queue("next");
    const send = {
      phase: "dispatched" as const,
      thread: {
        startedAt: now,
        preparingWorktree: false,
        submissionIntent: "foreground" as const,
        latestUserMessageId: null,
        latestTurnTurnId: TurnId.make("turn-1"),
        latestTurnRequestedAt: now,
        latestTurnStartedAt: now,
        latestTurnCompletedAt: "2026-10-07T10:01:00.000Z",
        sessionStatus: "ready" as const,
        sessionUpdatedAt: now,
        latestTurnStartFailureId: null,
      },
    };
    expect(backgroundQueuedMessageDue({ ...base, next, send })).toBe(false);
    const pickedUp = makeThread({
      session: session("ready"),
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "user",
          text: "first",
          turnId: TurnId.make("turn-2"),
          createdAt: now,
          updatedAt: now,
          streaming: false,
        },
      ],
      latestTurn: {
        turnId: TurnId.make("turn-2"),
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: "2026-10-07T10:02:00.000Z",
        assistantMessageId: null,
      },
    });
    expect(backgroundQueuedMessageDue({ ...base, thread: pickedUp, next, send })).toBe(true);
  });

  it("the next message waits for the one in flight, whichever sender took it", () => {
    const first = queue("first");
    const next = queue("next");
    // The open conversation takes the first and is still uploading it when the person leaves.
    expect(beginQueuedSend(threadKey, first.id, null)?.prompt).toBe("first");
    const inFlight = () => useQueuedMessageStore.getState().queuedSendByThreadKey[threadKey];

    expect(backgroundQueuedMessageDue({ ...base, next, send: inFlight() })).toBe(false);
    settleQueuedSend(threadKey, null);
    expect(backgroundQueuedMessageDue({ ...base, next, send: inFlight() })).toBe(true);
  });

  it("a message queued without its settings waits for its conversation", () => {
    const { sendSettings: _settings, ...withoutSettings } = {
      prompt: "overflow",
      images: [],
      terminalContexts: [],
      reviewComments: [],
      submissionIntent: "foreground" as const,
      sendSettings: settings,
      queuedAfterToolActivityId: null,
      createdAt: now,
    };
    const next = useQueuedMessageStore.getState().enqueue(threadKey, withoutSettings);
    expect(backgroundQueuedMessageDue({ ...base, next })).toBe(false);
  });
});

describe("sendQueuedMessageInBackground", () => {
  beforeEach(() => {
    useQueuedMessageStore.setState({
      queuesByThreadKey: {},
      drainGenerationByThreadKey: {},
      openThreadKeys: {},
      queuedSendByThreadKey: {},
    });
  });

  it("sends the queued text as a turn on its thread, with the settings it was queued with", async () => {
    const message = queue("run the tests", {
      sendSettings: { ...settings, modelSelection: opus, interactionMode: "plan" },
    });
    const deps = makeDeps(endedThread);

    await sendQueuedMessageInBackground(threadKey, message.id, deps);

    expect(deps.updateMetadata).toHaveBeenCalledWith({ threadId, modelSelection: opus });
    expect(deps.setInteractionMode).toHaveBeenCalledWith(
      expect.objectContaining({ threadId, interactionMode: "plan" }),
    );
    expect(deps.setRuntimeMode).not.toHaveBeenCalled();
    expect(deps.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "command-1",
        threadId,
        message: expect.objectContaining({ messageId: "message-1", text: "run the tests" }),
        modelSelection: opus,
        interactionMode: "plan",
      }),
    );
    expect(queued()).toEqual([]);
  });

  it("the effort it was queued with rides in the text for agents that read it there", async () => {
    const message = queue("think hard", {
      sendSettings: { ...settings, promptEffort: "ultrathink" },
    });
    const deps = makeDeps(endedThread);

    await sendQueuedMessageInBackground(threadKey, message.id, deps);

    expect(deps.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ text: "Ultrathink:\nthink hard" }),
      }),
    );
  });

  it("a refused send stays at the head of the queue, held with its reason", async () => {
    const first = queue("first");
    queue("second");
    const deps = makeDeps(endedThread, {
      startTurn: () =>
        Promise.resolve(AsyncResult.failure(Cause.fail(new Error("The agent is signed out.")))),
    });

    await sendQueuedMessageInBackground(threadKey, first.id, deps);

    expect(
      queued().map((entry) => [entry.prompt, entry.holdUntilUserAction, entry.heldReason]),
    ).toEqual([
      ["first", true, "The agent is signed out."],
      ["second", undefined, undefined],
    ]);
    expect(useQueuedMessageStore.getState().queuedSendByThreadKey[threadKey]).toBeUndefined();
  });

  it("an interrupted send goes back unheld for the next try, with the same ids", async () => {
    const first = queue("first");
    const deps = makeDeps(endedThread, {
      startTurn: () => Promise.resolve(AsyncResult.failure(Cause.interrupt())),
    });

    await sendQueuedMessageInBackground(threadKey, first.id, deps);

    expect(queued()).toEqual([
      expect.objectContaining({
        prompt: "first",
        retries: 1,
        sendIds: { commandId: "command-1", messageId: "message-1" },
      }),
    ]);
    expect(queued()[0]?.holdUntilUserAction).toBeUndefined();
  });

  it("a message in a crewmate's chat goes to the crew engine, never as a turn", async () => {
    const message = queue("@lead check this");
    const crewThread = makeThread({
      ...endedThread,
      crew: { crew: "crew-1", crewmate: "reviewer" },
    } as Partial<Thread>);
    const deps = makeDeps(crewThread);

    await sendQueuedMessageInBackground(threadKey, message.id, deps);

    expect(deps.sendCrew).toHaveBeenCalledWith(
      expect.objectContaining({ _tag: "message", handle: "reviewer", text: "@lead check this" }),
    );
    expect(deps.startTurn).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
  });

  it("Stop during its uploads starts no turn; it waits at the head for Send now", async () => {
    const message = queue("with a picture", {
      images: [
        {
          type: "image",
          id: "image-1",
          name: "shot.png",
          mimeType: "image/png",
          sizeBytes: 10,
          previewUrl: "blob:1",
          file: new File(["x"], "shot.png"),
        } as QueuedComposerMessage["images"][number],
      ],
    });
    const deps = makeDeps(endedThread, {
      uploads: {
        start: vi.fn(),
        settle: async () => {
          useQueuedMessageStore.getState().drain(threadKey);
        },
        uploaded: () => [],
        release: vi.fn(),
      },
    });

    await sendQueuedMessageInBackground(threadKey, message.id, deps);

    expect(deps.startTurn).not.toHaveBeenCalled();
    expect(queued()).toEqual([
      expect.objectContaining({ prompt: "with a picture", holdUntilUserAction: true }),
    ]);
  });

  it("Stop in another conversation never holds this one's message", async () => {
    const message = queue("with a picture", {
      images: [
        {
          type: "image",
          id: "image-1",
          name: "shot.png",
          mimeType: "image/png",
          sizeBytes: 10,
          previewUrl: "blob:1",
          file: new File(["x"], "shot.png"),
        } as QueuedComposerMessage["images"][number],
      ],
    });
    const deps = makeDeps(endedThread, {
      uploads: {
        start: vi.fn(),
        settle: async () => {
          useQueuedMessageStore.getState().drain("env-1:thread-other");
        },
        uploaded: () => [],
        release: vi.fn(),
      },
    });

    await sendQueuedMessageInBackground(threadKey, message.id, deps);

    expect(deps.startTurn).toHaveBeenCalledTimes(1);
    expect(queued()).toEqual([]);
  });

  it("a message whose only content expired leaves the queue without a turn", async () => {
    const message = queue("", {
      terminalContexts: [
        {
          id: "ctx-1",
          threadId,
          terminalId: "term-1",
          terminalLabel: "Terminal 1",
          lineStart: 1,
          lineEnd: 2,
          text: "",
          createdAt: now,
        } as QueuedComposerMessage["terminalContexts"][number],
      ],
    });
    const deps = makeDeps(endedThread);

    await sendQueuedMessageInBackground(threadKey, message.id, deps);

    expect(deps.startTurn).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
  });
});

describe("a queued message's send receipt", () => {
  beforeEach(() => {
    useQueuedMessageStore.setState({
      queuesByThreadKey: {},
      drainGenerationByThreadKey: {},
      openThreadKeys: {},
      queuedSendByThreadKey: {},
    });
  });

  const accountReceipts = () => {
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    const receipts = makeSendTurnReceipts(store, registry);
    const operations = () =>
      [...store.state().operations.values()].map((record) => ({
        requestId: record.requestId,
        intent: { ...record.intent, at: "sent" },
        submission: record.submission,
        outcome: record.receipt?.outcome.kind ?? null,
        nextAction: record.unresolved?.nextAction ?? null,
      }));
    return { receipts, operations };
  };

  /** The open conversation's send of the same message, as `ChatView` records it. */
  const sentFromOpenView = (prompt: string, outcome: "accepted" | "refused") => {
    const account = accountReceipts();
    const ask = turnSendAsk({
      trimmedPrompt: prompt.trim(),
      messageId: "message-1",
      threadId,
      at: now,
    });
    if (ask !== null) account.receipts.requested(environmentId, ask);
    if (outcome === "accepted") account.receipts.accepted(environmentId, "message-1");
    else account.receipts.failed(environmentId, "message-1", true);
    return account.operations();
  };

  it.each([
    ["accepted", ok],
    [
      "refused",
      () => Promise.resolve(AsyncResult.failure(Cause.fail(new Error("The agent is signed out.")))),
    ],
  ] as const)(
    "the root sender records the same send operation as the open conversation (%s)",
    async (outcome, startTurn) => {
      const message = queue("run the tests");
      const account = accountReceipts();
      const deps = makeDeps(endedThread, { receipts: account.receipts, startTurn });

      await sendQueuedMessageInBackground(threadKey, message.id, deps);

      expect(account.operations()).toEqual(sentFromOpenView("run the tests", outcome));
      expect(account.operations()).toEqual([
        expect.objectContaining({
          intent: expect.objectContaining({
            kind: "mate-send-turn",
            environmentId,
            messageId: "message-1",
            threadId,
            text: "run the tests",
          }),
        }),
      ]);
    },
  );

  it("a send that never reached the turn says it was not sent, and starts no turn", async () => {
    const message = queue("plan it", { sendSettings: { ...settings, interactionMode: "plan" } });
    const account = accountReceipts();
    const deps = makeDeps(endedThread, {
      receipts: account.receipts,
      setInteractionMode: () => Promise.resolve(AsyncResult.failure(Cause.fail(new Error("no")))),
    });

    await sendQueuedMessageInBackground(threadKey, message.id, deps);

    expect(deps.startTurn).not.toHaveBeenCalled();
    expect(account.operations()).toEqual([
      expect.objectContaining({ submission: "unsent", outcome: null }),
    ]);
  });

  it("a crewmate's message records no turn send, as in its open conversation", async () => {
    const message = queue("@lead check this");
    const crewThread = makeThread({
      ...endedThread,
      crew: { crew: "crew-1", crewmate: "reviewer" },
    } as Partial<Thread>);
    const account = accountReceipts();

    await sendQueuedMessageInBackground(
      threadKey,
      message.id,
      makeDeps(crewThread, { receipts: account.receipts }),
    );

    expect(account.operations()).toEqual([]);
  });
});

describe("turnSendAsk", () => {
  it.each([
    ["words", "run the tests", "run the tests"],
    ["a slash command", "/compact", null],
    ["no words", "", null],
  ])("records %s as %j", (_label, prompt, text) => {
    const ask = turnSendAsk({ trimmedPrompt: prompt, messageId: "m", threadId: "t", at: now });
    expect(ask?.text ?? null).toBe(text);
  });
});
