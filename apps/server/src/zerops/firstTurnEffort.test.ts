import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  type ModelSelection,
  MessageId,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  makeFirstTurnEffort,
  planFirstTurnEffort,
  type FirstTurnThread,
  type TurnStart,
} from "./firstTurnEffort.ts";

// D10 on the server: a new conversation's first turn runs on Extra High when it names no effort —
// a phone task queued before the catalog arrived, a stand-up — and the thread stores what it ran
// on, so a reload reads it back.
const claude: ServerProvider = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-05T10:00:00.000Z",
  models: [
    {
      slug: "claude-opus-5-5",
      name: "Opus 5.5",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: [
              { id: "medium", label: "Medium", isDefault: true },
              { id: "xhigh", label: "Extra High" },
              { id: "max", label: "Max" },
            ],
          },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
};

const opus = (effort?: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
  ...(effort ? { options: [{ id: "effort", value: effort }] } : {}),
});

const turn = (overrides: Partial<TurnStart> = {}): TurnStart => ({
  type: "thread.turn.start",
  commandId: CommandId.make("c-1"),
  threadId: ThreadId.make("t-1"),
  message: { messageId: MessageId.make("m-1"), role: "user", text: "hi", attachments: [] },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: "2026-10-05T10:00:00.000Z",
  ...overrides,
});

const thread = (overrides: Partial<FirstTurnThread> = {}): FirstTurnThread => ({
  latestTurn: null,
  modelSelection: opus(),
  ...overrides,
});

const createThread = (modelSelection: ModelSelection) => ({
  createThread: {
    projectId: ProjectId.make("p-1"),
    title: "New thread",
    modelSelection,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    createdAt: "2026-10-05T10:00:00.000Z",
  },
});

describe("planFirstTurnEffort", () => {
  const cases: ReadonlyArray<
    readonly [
      string,
      TurnStart,
      FirstTurnThread | undefined,
      { readonly turn: ModelSelection | undefined; readonly store: ModelSelection | undefined },
    ]
  > = [
    [
      "a first turn naming no selection runs on the thread's, with Extra High, and stores it",
      turn(),
      thread(),
      { turn: opus("xhigh"), store: opus("xhigh") },
    ],
    [
      "a first turn naming no effort gets Extra High, stored on the thread",
      turn({ modelSelection: opus() }),
      thread(),
      { turn: opus("xhigh"), store: opus("xhigh") },
    ],
    [
      "a first turn the client filled is stored when the thread holds none",
      turn({ modelSelection: opus("xhigh") }),
      thread(),
      { turn: opus("xhigh"), store: opus("xhigh") },
    ],
    [
      "a person's pick wins, and the thread stores it",
      turn({ modelSelection: opus("medium") }),
      thread(),
      { turn: opus("medium"), store: opus("medium") },
    ],
    [
      "nothing is stored when the thread already holds it",
      turn({ modelSelection: opus("xhigh") }),
      thread({ modelSelection: opus("xhigh") }),
      { turn: opus("xhigh"), store: undefined },
    ],
    [
      "a conversation that ran keeps what it sends",
      turn({ modelSelection: opus() }),
      thread({ latestTurn: { turnId: "x" } as never }),
      { turn: opus(), store: undefined },
    ],
    [
      "a crewmate's thread keeps the crew's rule",
      turn({ modelSelection: opus() }),
      thread({ crew: {} as never }),
      { turn: opus(), store: undefined },
    ],
    [
      "an unknown thread is left alone",
      turn({ modelSelection: opus() }),
      undefined,
      { turn: opus(), store: undefined },
    ],
  ];
  it.each(cases)("%s", (_name, input, current, expected) => {
    const plan = planFirstTurnEffort({ turn: input, thread: current, providers: [claude] });
    expect({ turn: plan.turn.modelSelection, store: plan.store }).toEqual(expected);
  });

  it("a thread the turn creates is created on Extra High, and the turn runs on it", () => {
    const plan = planFirstTurnEffort({
      turn: turn({ modelSelection: opus(), bootstrap: createThread(opus()) }),
      thread: undefined,
      providers: [claude],
    });
    expect([
      plan.turn.modelSelection,
      plan.turn.bootstrap?.createThread?.modelSelection,
      plan.store,
    ]).toEqual([opus("xhigh"), opus("xhigh"), undefined]);
  });
});

describe("makeFirstTurnEffort", () => {
  const shell = (current: FirstTurnThread | undefined) => () =>
    Effect.succeed(Option.fromNullishOr(current as OrchestrationThreadShell | undefined));
  const firstTurn = (
    threadShell: () => Effect.Effect<
      Option.Option<OrchestrationThreadShell>,
      { readonly _tag: "ReadFailed" }
    >,
  ) => makeFirstTurnEffort({ providers: Effect.succeed([claude]), threadShell });

  it.effect("a client's first turn goes out on Extra High after the thread stores it", () =>
    Effect.gen(function* () {
      const planned = yield* firstTurn(shell(thread()))(turn({ modelSelection: opus() }));
      expect(planned).toEqual({
        command: turn({ modelSelection: opus("xhigh") }),
        store: {
          type: "thread.meta.update",
          commandId: CommandId.make("c-1-effort"),
          threadId: ThreadId.make("t-1"),
          modelSelection: opus("xhigh"),
        },
      });
    }),
  );

  it.effect("any other command, or a thread it cannot read, goes out as it came", () =>
    Effect.gen(function* () {
      const archive = {
        type: "thread.archive",
        commandId: CommandId.make("c-2"),
        threadId: ThreadId.make("t-1"),
      } as const;
      expect(yield* firstTurn(shell(thread()))(archive)).toEqual({
        command: archive,
        store: undefined,
      });
      const unread = yield* firstTurn(() => Effect.fail({ _tag: "ReadFailed" } as const))(
        turn({ modelSelection: opus() }),
      );
      expect(unread).toEqual({ command: turn({ modelSelection: opus() }), store: undefined });
    }),
  );
});
