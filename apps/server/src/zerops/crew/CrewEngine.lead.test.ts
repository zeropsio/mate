import { assert, describe, it } from "@effect/vitest";
import type { CrewRunOptions, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { CrewThreadDirectory, CrewToolHost, type CrewThreadMember } from "./crewSeams.ts";
import {
  eventually,
  spiEvent,
  withCrewEngine,
  writeCrewHome,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import {
  command,
  dispatchedOf,
  everyCopyReady,
  firstTurn,
  latest,
  reportDone,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { read, write } from "./testing/crewGitFixture.ts";

const RUN: CrewRunOptions = {
  budgetUsd: "unlimited",
  timeLimitHours: "unlimited",
  stopAtUsagePercent: null,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

/** A crew with a lead and a writer, applied. */
const withLead = (world: CrewWorld) =>
  Effect.gen(function* () {
    writeCrewHome(world.workspace, {
      "crew.yaml": [
        "name: Game team",
        "briefTitle: Space shooter",
        "members:",
        "  - handle: lead",
        "    displayName: Lead",
        "    kind: lead",
        "  - handle: backend",
        "    displayName: Backend",
        "    host: appdev",
        "    check: test -f ok.txt",
        "",
      ].join("\n"),
      "jobs/lead.md": "Plan the work.\n",
    });
    yield* command({ _tag: "apply" });
    yield* eventually(Effect.map(latest, everyCopyReady));
  });

const startRun = (options: Partial<CrewRunOptions> = {}) =>
  command({ _tag: "start", ...RUN, ...options });

/** The lead's conversation, once the engine opened one. */
const leadThread = (world: CrewWorld) =>
  Effect.gen(function* () {
    yield* eventually(
      Effect.map(dispatchedOf(world, "thread.crew.create"), (creates) =>
        creates.some((entry) => entry.crew.crewmate === "lead"),
      ),
    );
    return (yield* dispatchedOf(world, "thread.crew.create")).find(
      (entry) => entry.crew.crewmate === "lead",
    )!.threadId;
  });

const memberOf = (thread: ThreadId) =>
  Effect.map(
    Effect.flatMap(CrewThreadDirectory, (directory) => directory.memberFor(thread)),
    (member): CrewThreadMember => Option.getOrThrow(member),
  );

const lastTurnText = (world: CrewWorld, thread: ThreadId) =>
  Effect.map(
    dispatchedOf(world, "thread.turn.start"),
    (turns) => turns.findLast((turn) => turn.threadId === thread)?.message.text ?? "",
  );

/** The lead's turn ends with `reply` as its last message. */
const leadReplies = (world: CrewWorld, thread: ThreadId, reply: string) =>
  Effect.gen(function* () {
    yield* world.publish(spiEvent("turn.started", thread, {}));
    yield* world.publish(
      spiEvent("content.delta", thread, { streamKind: "assistant_text", delta: reply }),
    );
    yield* world.publish(
      spiEvent("item.completed", thread, { itemType: "assistant_message", status: "completed" }),
    );
    yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
  });

const PLAN = [
  { owner: "backend", title: "Camera", brief: "Follow the player.", doneWhen: "npm test passes" },
  { owner: "backend", title: "HUD", brief: "Show the score.", dependsOn: ["Camera"] },
];

describe("CrewEngine lead", () => {
  it.live("a message to the lead is a turn of its own, never a task", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const thread = yield* leadThread(world);
        assert.deepStrictEqual(
          [yield* lastTurnText(world, thread), (yield* latest).board.tasks],
          ["Plan it", []],
        );
      }),
    ),
  );

  it.live("crew_propose puts a plan on the board; Start queues it and only a run starts it", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* memberOf(yield* leadThread(world));
        const answer = yield* (yield* CrewToolHost).propose(lead, PLAN);
        const proposed = yield* snapshotWhere((current) => current.board.tasks.length === 2);
        yield* command({
          _tag: "planAccept",
          taskIds: [proposed.board.tasks[0]!.id, proposed.board.tasks[1]!.id],
        });
        const accepted = yield* snapshotWhere((current) =>
          current.board.tasks.every((task) => task.state === "queued"),
        );
        const beforeRun = (yield* dispatchedOf(world, "thread.turn.start")).length;
        yield* startRun();
        const running = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          {
            answer: answer.text.startsWith("Proposed #1 Camera (@backend), #2 HUD (@backend)"),
            proposed: proposed.board.tasks.map((task) => [task.state, task.source]),
            plan: proposed.attention.map((row) => [row.id, row.kind, row.handle]),
            dependsOn: proposed.board.tasks[1]!.dependsOn,
            accepted: [accepted.attention.length, beforeRun],
            running: running.board.tasks.map((task) => task.state),
          },
          {
            answer: true,
            proposed: [
              ["proposed", "lead"],
              ["proposed", "lead"],
            ],
            plan: [["plan:lead", "plan", "lead"]],
            dependsOn: [proposed.board.tasks[0]!.id],
            accepted: [0, 1],
            running: ["working", "queued"],
          },
        );
      }),
    ),
  );

  it.live("a run that lets the lead start tasks queues its plan and starts it", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ leadMayStart: true });
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* memberOf(yield* leadThread(world));
        yield* (yield* CrewToolHost).propose(lead, PLAN);
        const running = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [running.board.tasks.map((task) => task.state), running.attention],
          [["working", "queued"], []],
        );
      }),
    ),
  );

  it.live("in a run the lead lands, a passed check wakes the lead; its accept lands the task", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const inReview = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "review",
        );
        const lead = yield* leadThread(world);
        const wake = yield* lastTurnText(world, lead);
        const answer = yield* (yield* CrewToolHost).review(yield* memberOf(lead), {
          task: 1,
          verdict: "accept",
          note: "Looks right.",
        });
        const landed = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "landed",
        );
        assert.deepStrictEqual(
          {
            review: inReview.board.tasks[0]!.state,
            wake: wake.includes("review @backend's work") && wake.includes("crew_review"),
            answer: answer.text,
            verdict: landed.board.tasks[0]!.review,
            tree: read(world.root, "ok.txt"),
          },
          {
            review: "review",
            wake: true,
            answer: "#1 is accepted.",
            verdict: { verdict: "accept", note: "Looks right.", by: "lead" },
            tree: "ok\n",
          },
        );
      }),
    ),
  );

  it.live("the lead's reject sends the task back to its crewmate with the note", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun({ landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "review");
        const lead = yield* leadThread(world);
        yield* (yield* CrewToolHost).review(yield* memberOf(lead), {
          task: 1,
          verdict: "reject",
          note: "Name the file hud.ts.",
        });
        const reworked = yield* snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
        );
        const rework = yield* lastTurnText(world, thread);
        assert.deepStrictEqual(
          [rework.includes("rework after review"), rework.includes("Name the file hud.ts.")],
          [true, true],
        );
        assert.strictEqual(reworked.board.tasks[0]!.review?.verdict, "reject");
      }),
    ),
  );

  it.live("a crewmate's question goes to the lead first; the lead's reply is its answer", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun();
        const thread = yield* firstTurn(world, () => undefined);
        yield* (yield* CrewToolHost).report(yield* memberOf(thread), {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const blocked = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "blocked",
        );
        const lead = yield* leadThread(world);
        const wake = yield* lastTurnText(world, lead);
        yield* leadReplies(world, lead, "Use EUR.");
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "working");
        assert.deepStrictEqual(
          {
            waiting: blocked.attention,
            wake: wake.includes("@backend asks") && wake.includes("CZK or EUR?"),
            answer: (yield* lastTurnText(world, thread)).split("\n").slice(1),
          },
          {
            waiting: [],
            wake: true,
            answer: ["#1 Change a.txt · answer from @lead", "Use EUR."],
          },
        );
      }),
    ),
  );

  it.live("a question the lead passes on reaches you at once", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun();
        const thread = yield* firstTurn(world, () => undefined);
        yield* (yield* CrewToolHost).report(yield* memberOf(thread), {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const lead = yield* leadThread(world);
        yield* (yield* CrewToolHost).report(yield* memberOf(lead), {
          status: "blocked",
          summary: "The person decides the currency.",
          question: "CZK or EUR?",
        });
        yield* world.publish(spiEvent("turn.completed", lead, { state: "completed" }));
        const asked = yield* snapshotWhere((current) => current.attention.length === 1);
        assert.deepStrictEqual(
          asked.attention.map((row) => [row.kind, row.handle, row.text]),
          [["question", "backend", "CZK or EUR?"]],
        );
      }),
    ),
  );

  it.live("the lead's own question waits on you, and your answer reaches the lead", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* command({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* leadThread(world);
        yield* (yield* CrewToolHost).report(yield* memberOf(lead), {
          status: "blocked",
          summary: "Mobile first?",
        });
        yield* world.publish(spiEvent("turn.completed", lead, { state: "completed" }));
        const asked = yield* snapshotWhere((current) => current.attention.length === 1);
        yield* command({ _tag: "answer", handle: "lead", taskId: null, text: "Desktop first." });
        const answered = yield* snapshotWhere((current) => current.attention.length === 0);
        assert.deepStrictEqual(
          [
            asked.attention.map((row) => [row.kind, row.handle, row.taskId, row.text]),
            answered.attention,
            yield* lastTurnText(world, lead),
          ],
          [[["question", "lead", null, "Mobile first?"]], [], "Desktop first."],
        );
      }),
    ),
  );

  it.live("crew_finish ends the run", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun();
        yield* command({ _tag: "message", handle: "lead", text: "Wrap up", attachments: [] });
        const answer = yield* (yield* CrewToolHost).finish(
          yield* memberOf(yield* leadThread(world)),
          { summary: "Every Done when line is met." },
        );
        const finished = yield* snapshotWhere((current) => current.run?.state === "finished");
        assert.deepStrictEqual(
          [answer.text, finished.run!.state],
          ["The run is finished.", "finished"],
        );
      }),
    ),
  );
});
