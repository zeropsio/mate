import { expect, it } from "vite-plus/test";
import {
  CommandId,
  ConversationId,
  SessionId,
  effectId,
  runId,
  type ItemBody,
  type Principal,
} from "@t3tools/contracts";
import { BOARD_TITLE_MAX } from "@t3tools/shared/hqIntake";

import { boardAskOfCall } from "../pump/boardAsk.ts";
import { changeOpenedOfCall } from "../pump/changeOpened.ts";
import type { Command, EffectDraft } from "./command.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const ana: Principal = { kind: "person", subject: "ana" };
const T0 = 1_000_000_000;
const s1 = SessionId.make("s1");

/** A finished zcp call whose answer is `answer`, written as JSON. */
const zcpCall = (answer: unknown, toolName = "zerops_board_propose"): ItemBody => ({
  kind: "call",
  step: "mcp",
  tool: { name: toolName, server: "zerops" },
  words: null,
  state: "done",
  endedAt: 1,
  result: { toolName, resultText: JSON.stringify(answer) },
});

// witness: apps/server/src/engine/pump/boardAsk.ts | return cut.title === "" || cut.brief === "" ? null : cut; → return cut.title === "" ? null : cut;
it("ED146: A zcp call proposes work for the Board only from `zerops_board_propose` answering a title and a brief, both trimmed and cut to what HQ takes; an answer missing either, or any other tool's, asks nothing", () => {
  const proposed = (board: Record<string, unknown>) => ({
    proposed: { board },
    nextActions: "Say it in one sentence.",
  });
  const long = "t".repeat(BOARD_TITLE_MAX + 30);
  const rows: ReadonlyArray<readonly [ItemBody, unknown]> = [
    [
      zcpCall(proposed({ title: " Cache the menu ", brief: " The menu reads every visit. " })),
      { kind: "board", title: "Cache the menu", brief: "The menu reads every visit." },
    ],
    [
      zcpCall(proposed({ title: long, brief: "Why." })),
      { kind: "board", title: "t".repeat(BOARD_TITLE_MAX), brief: "Why." },
    ],
    [zcpCall(proposed({ title: "Cache the menu", brief: "  " })), null],
    [zcpCall(proposed({ title: "Cache the menu" })), null],
    [zcpCall(proposed({ brief: "The menu reads every visit." })), null],
    [zcpCall(proposed({ title: "Cache the menu", brief: "Why." }), "zerops_mirror"), null],
  ];
  for (const [body, ask] of rows) expect(boardAskOfCall(body)).toEqual(ask);
});

// witness: apps/server/src/engine/pump/boardAsk.ts | typeof need === "string" && need.trim() !== "" && need.trim() !== key → typeof need === "string" && need.trim() !== ""
it("ED150: A plan zcp proposes for the Board opens one plan ask with its tasks in its order, each keeping its key and needing only others, each once; a plan of one task is a single task's ask, and one with two tasks under one key, or more tasks than HQ takes, asks nothing; breaks: a plan's task names itself among its needs and HQ refuses the whole plan as a cycle, or a plan HQ refuses reaches the person's card", () => {
  const plan = (tasks: ReadonlyArray<unknown>) =>
    zcpCall({ proposed: { board: { plan: tasks } }, nextActions: "Say it in one sentence." });
  const task = (key: string, needs?: ReadonlyArray<string>) => ({
    key,
    title: ` Step ${key} `,
    brief: `Do ${key}.`,
    ...(needs === undefined ? {} : { needs }),
  });
  expect({
    ordered: boardAskOfCall(plan([task("a"), task("b", ["a", "b", "a"]), task("c", ["b"])])),
    one: boardAskOfCall(plan([task("a")])),
    twice: boardAskOfCall(plan([task("a"), task("a")])),
    tooMany: boardAskOfCall(plan(Array.from({ length: 21 }, (_, at) => task(`k${String(at)}`)))),
  }).toEqual({
    ordered: {
      kind: "board-plan",
      tasks: [
        { key: "a", title: "Step a", brief: "Do a.", needs: [] },
        { key: "b", title: "Step b", brief: "Do b.", needs: ["a"] },
        { key: "c", title: "Step c", brief: "Do c.", needs: ["b"] },
      ],
    },
    one: { kind: "board", title: "Step a", brief: "Do a." },
    twice: null,
    tooMany: null,
  });
});

const settled = (cause: string, kind: string, value?: unknown): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(cause, kind, 1),
  outcome: value === undefined ? { kind: "ok" } : { kind: "ok", value },
});

/** Decides each command in `conversation` under a literal clock: the state, the effects asked, the refusals. */
const play = (conversation: ConversationId, steps: ReadonlyArray<Command>) => {
  let state: ConversationState = initialState(conversation);
  const effects: Array<EffectDraft> = [];
  const refused: Array<number> = [];
  steps.forEach((command, index) => {
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: ana,
      command,
    };
    const decided = decide(state, envelope, T0 + index);
    if (decided._tag === "Reject") {
      refused.push(index);
      return;
    }
    effects.push(...decided.step.effects);
    state = fold(state, stampEvents(state.headSeq, envelope, decided.step.events, T0 + index));
  });
  return { effects, refused };
};

const TAKEN = {
  taskId: "task-7",
  task: {
    kind: "conversation",
    putBy: "ben",
    mateProjectId: "mate-ben",
    conversationId: "ben-chat",
    title: "Cache the menu",
  },
} as const;

/** A conversation whose first message is `first`, at work, opening change kiln#4 and then a second message. */
const opening = (conversation: ConversationId, first: Command) => {
  const r1 = runId(conversation, 1);
  return play(conversation, [
    first,
    settled(r1, "run.prepare"),
    settled(r1, "session.open", {
      sessionId: "s1",
      driver: "claude",
      model: null,
      nativeRef: "native-1",
      capabilities: { steer: false },
    }),
    settled(r1, "provider.send", { providerTurnId: "t1" }),
    {
      _tag: "ProviderSignals",
      sessionId: s1,
      signals: [{ kind: "change-opened", repo: "kiln", number: 4 }],
    },
    { _tag: "Send", text: "Also the footer.", taskId: "task-8", task: TAKEN.task },
  ]);
};

const links = (effects: ReadonlyArray<EffectDraft>) =>
  effects.filter((effect) => effect.kind === "task.change").map((effect) => effect.payload);

// witness: apps/server/src/engine/domain/decide.send.ts | (b.state.lastPersonSeq > 0 || b.state.takenTask !== undefined) → b.state.takenTask !== undefined
it("ED147: A conversation opened with a task the person took from the Board links each change it opens to that task, and a conversation no task was taken for links none; a taken task's brief into a conversation under way is refused; breaks: a person's taken task never ends when its change merges, or another conversation's change is attached to it", () => {
  const taken = opening(ConversationId.make("ana-take"), {
    _tag: "Send",
    text: "The menu reads every visit; cache it.",
    ...TAKEN,
  });
  const plain = opening(ConversationId.make("ana-chat"), {
    _tag: "Send",
    text: "Cache the menu.",
  });
  // the trailing send names another task: refused in both, the conversation is already under way
  expect({
    taken: links(taken.effects),
    takenRefused: taken.refused,
    plain: links(plain.effects),
    plainRefused: plain.refused,
  }).toEqual({
    taken: [{ taskId: "task-7", repo: "kiln", number: 4 }],
    takenRefused: [5],
    plain: [],
    plainRefused: [5],
  });
});

// witness: packages/shared/src/hqChanges.ts | if (matched === null || Number(matched[2]) !== number) return null; → if (matched === null) return null;
it("ED148: A change the agent opened is read off zcp's `open-change` answer as the repository its address names and the number it answers, only where both agree; any other answer or tool names no change", () => {
  const opened = (pullRequest: unknown, pullRequestUrl: unknown) => ({
    service: "appdev",
    branch: "menu-cache",
    pullRequest,
    pullRequestUrl,
    created: true,
    message: "Change #4 is open.",
  });
  const HQ = "https://hq.example.invalid/changes/app-1";
  const rows: ReadonlyArray<readonly [ItemBody, unknown]> = [
    [zcpCall(opened(4, `${HQ}/kiln/4`), "zerops_workflow"), { repo: "kiln", number: 4 }],
    [zcpCall(opened(4, `${HQ}/kiln%20two/4`), "zerops_workflow"), { repo: "kiln two", number: 4 }],
    [zcpCall(opened(4, `${HQ}/kiln/5`), "zerops_workflow"), null],
    [zcpCall(opened(4, "https://hq.example.invalid/apps/app-1"), "zerops_workflow"), null],
    [zcpCall(opened("4", `${HQ}/kiln/4`), "zerops_workflow"), null],
    [zcpCall(opened(4, `${HQ}/kiln/4`), "zerops_deploy"), null],
  ];
  for (const [body, change] of rows)
    expect(changeOpenedOfCall(body, { action: "open-change" })).toEqual(change);
});
// witness: apps/server/src/engine/pump/changeOpened.ts | if (args.action !== CHANGE_OPEN_ACTION) return null; → if (args.action === "close-change") return null;
it("ED149: Only the agent's `open-change` call links a change to a taken task: its `describe-change`, a call without its action, or any other action naming the same change in the same fields links nothing; breaks: describing or closing a change links it to the task again, or a closed change is linked as if opened", () => {
  const answer = {
    service: "appdev",
    branch: "menu-cache",
    pullRequest: 4,
    pullRequestUrl: "https://hq.example.invalid/changes/app-1/kiln/4",
  };
  const body = zcpCall(answer, "zerops_workflow");
  const rows: ReadonlyArray<readonly [unknown, unknown]> = [
    [{ action: "open-change" }, { repo: "kiln", number: 4 }],
    [{ action: "describe-change" }, null],
    [{ action: "update-change" }, null],
    [{}, null],
    [undefined, null],
  ];
  for (const [args, change] of rows) expect(changeOpenedOfCall(body, args)).toEqual(change);
});
