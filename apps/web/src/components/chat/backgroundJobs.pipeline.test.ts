/**
 * A command sent to the background, end to end from the activities the
 * server sends (review of pass 39: the card tests found jobs through
 * `task.started` rows, which the work log drops): its call's own notice, the
 * task's start — dropped — and its completion, after the turn.
 */
import { EventId, MessageId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  callItem,
  engineRun,
  engineThreadOfRecords,
  noteItem,
  personItem,
  workItem,
} from "@t3tools/client-runtime/data/fixtures";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows, type MessagesTimelineRow } from "./MessagesTimeline.logic";
import { foldBackgroundTasks } from "./conversationDock.logic";

const at = (second: number) => new Date(Date.UTC(2026, 9, 4, 8, 0, second)).toISOString();
let next = 0;

function activity(
  kind: string,
  second: number,
  payload: Record<string, unknown>,
  turn: string | null,
  tone: OrchestrationThreadActivity["tone"] = "tool",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`pipeline-${next++}`),
    createdAt: at(second),
    kind,
    summary: kind,
    tone,
    payload,
    turnId: turn === null ? null : TurnId.make(turn),
  } as OrchestrationThreadActivity;
}

/** A Bash call that went to the background: its start, and its return with the notice. */
const sentAway = (call: string, job: string, description: string, second: number) => {
  const data = { toolName: "Bash", command: `./${job}.sh`, input: { description } };
  return [
    activity(
      "tool.started",
      second,
      { itemType: "command_execution", toolCallId: call, status: "inProgress", data },
      "t1",
    ),
    activity(
      "tool.completed",
      second + 1,
      {
        itemType: "command_execution",
        toolCallId: call,
        status: "completed",
        data: {
          ...data,
          rawOutput: {
            content: `Command running in background with ID: ${job}. Output is being written to: /tmp/x/${job}.output`,
          },
        },
      },
      "t1",
    ),
    activity(
      "task.started",
      second + 1,
      {
        taskId: job,
        taskType: "local_bash",
        agentKind: "background",
        title: description,
        toolUseId: call,
      },
      "t1",
      "info",
    ),
  ];
};

const reported = (
  call: string,
  job: string,
  description: string,
  second: number,
  failed: boolean,
) =>
  activity(
    "task.completed",
    second,
    {
      taskId: job,
      taskType: "local_bash",
      agentKind: "background",
      title: description,
      toolUseId: call,
      status: failed ? "failed" : "completed",
      detail: `Background command "${description}" ${failed ? "failed with exit code 3" : "completed (exit code 0)"}`,
    },
    null,
    failed ? "error" : "info",
  );

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
  second: number,
  turn: string | null,
) =>
  ({
    id: MessageId.make(id),
    role,
    text,
    turnId: turn === null ? null : TurnId.make(turn),
    streaming: false,
    createdAt: at(second),
    updatedAt: at(second),
  }) as ChatMessage;

function rows(activities: OrchestrationThreadActivity[], live: ReadonlyArray<string> | null) {
  return deriveMessagesTimelineRows({
    timelineEntries: deriveTimelineEntries(
      [
        message("m0", "user", "Run them in the background.", 0, null),
        message("a1", "assistant", "Both are running.", 5, "t1"),
      ],
      [],
      deriveWorkLogEntries(activities),
    ),
    latestTurn: {
      turnId: TurnId.make("t1"),
      state: "completed",
      startedAt: at(0),
      completedAt: at(5),
    },
    runningTurnId: null,
    isWorking: false,
    activeTurnStartedAt: null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    nowMs: Date.parse(at(600)),
    ...(live === null ? {} : { liveJobs: { ids: new Set(live) } }),
  });
}

const jobs = (list: MessagesTimelineRow[]) =>
  list.flatMap((row) =>
    row.kind === "background" && row.jobs !== undefined
      ? row.jobs.map(
          (job) => `${job.title}: ${job.state}${job.report === null ? "" : ` (${job.report})`}`,
        )
      : [],
  );

describe("a command sent to the background, from the server's activities", () => {
  const launched = [
    ...sentAway("call-soak", "bsoak", "Run the soak test", 1),
    ...sentAway("call-fail", "bfail", "Run the failing job", 2),
  ];

  it.each([
    {
      name: "both still running past the turn",
      later: [] as OrchestrationThreadActivity[],
      live: ["bsoak", "bfail"],
      said: ["Run the soak test: running", "Run the failing job: running"],
    },
    {
      name: "one failed after the turn",
      later: [reported("call-fail", "bfail", "Run the failing job", 30, true)],
      live: ["bsoak"],
      said: ["Run the soak test: running", "Run the failing job: failed (Exit code 3)"],
    },
    {
      name: "both reported",
      later: [
        reported("call-fail", "bfail", "Run the failing job", 30, true),
        reported("call-soak", "bsoak", "Run the soak test", 60, false),
      ],
      live: [],
      said: ["Run the soak test: done", "Run the failing job: failed (Exit code 3)"],
    },
    {
      name: "the session gone before either reported",
      later: [] as OrchestrationThreadActivity[],
      live: [],
      said: ["Run the soak test: lost", "Run the failing job: lost"],
    },
  ])("tells each job once, on its turn's card: $name", ({ later, live, said }) => {
    const list = rows([...launched, ...later], live);
    expect(jobs(list)).toEqual(said);
    // Nowhere else: no loose line for a job's report.
    expect(list.filter((row) => row.kind === "work")).toEqual([]);
  });
});

describe("an engine Mate's command sent to the background, from its records", () => {
  const key = { environmentId: "env-ada", conversationId: "thread-ada" };
  const run1 = "thread-ada/r/1";
  const run2 = "thread-ada/r/2";
  const sleep = "Wait two minutes, then print a confirmation";
  const records = (status: "running" | "completed" | "failed" | "lost", working: boolean) => ({
    runs: [
      engineRun("thread-ada", 1),
      ...(working ? [engineRun("thread-ada", 2, { state: "running", end: null })] : []),
    ],
    items: [
      personItem(run1, 1, "Run sleep 120 then reply SLEPT."),
      callItem(run1, 2, {
        shows: {
          toolName: "Bash",
          command: "sleep 120 && echo slept",
          input: { description: sleep },
          rawOutput: {
            content:
              "Command running in background with ID: bsleep. Output is being written to: /tmp/x/bsleep.output",
          },
        },
      }),
      workItem(run1, 3, { work: "bsleep", workKind: "shell", status, title: sleep }),
      noteItem(run1, 4, "I'll reply once it finishes."),
      ...(working ? [personItem(run2, 5, "Still there?")] : []),
    ],
  });

  function engineJobs(status: "running" | "completed" | "failed" | "lost", working: boolean) {
    const thread = engineThreadOfRecords(key, records(status, working));
    if (thread === null) throw new Error("no thread");
    const list = deriveMessagesTimelineRows({
      timelineEntries: deriveTimelineEntries(
        thread.messages as ReadonlyArray<ChatMessage>,
        [],
        deriveWorkLogEntries(thread.activities),
      ),
      latestTurn: thread.latestTurn,
      runningTurnId: working ? TurnId.make(run2) : null,
      isWorking: working,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
      nowMs: Date.parse(at(600)),
      // An engine Mate names no live jobs: what the server holds is not said while it works.
      liveJobs: working ? null : { ids: new Set<string>() },
    });
    return {
      card: jobs(list),
      band: foldBackgroundTasks(thread.activities).map((task) => `${task.title}: ${task.state}`),
    };
  }

  it.each([
    { status: "completed", working: false, card: "done", band: "done" },
    { status: "failed", working: false, card: "failed", band: "failed" },
    { status: "lost", working: false, card: "lost", band: "lost" },
    { status: "lost", working: true, card: "lost", band: "lost" },
  ] as const)(
    "work a restart cut never reads finished: $status, the Mate working $working",
    ({ status, working, card, band }) => {
      expect(engineJobs(status, working)).toEqual({
        card: [`${sleep}: ${card}`],
        band: [`${sleep}: ${band}`],
      });
    },
  );
});
