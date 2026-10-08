import { assert, describe, it } from "@effect/vitest";
import type { CrewRunOptions } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { CREW_ID } from "./CrewHome.ts";
import { CrewStore } from "./CrewStore.ts";
import { git, read, write } from "./testing/crewGitFixture.ts";
import {
  crewJourney,
  eventually,
  everyCopyReady,
  firstTurn,
  itV1,
  onV1,
  opened,
  reportDone,
  seamsOf,
  turnsSent,
  v1Journey,
  type CrewChat,
  type CrewWorld,
} from "./testing/crewWorld.ts";

const RUN: CrewRunOptions = {
  budgetUsd: "unlimited",
  timeLimitHours: "unlimited",
  stopAtUsagePercent: null,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

/** A crew with a lead and a writer, applied; the writer's check is `check`, none when null. */
const withLead = (world: CrewWorld, check: string | null = "test -f ok.txt") =>
  Effect.gen(function* () {
    world.writeHome({
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
        ...(check === null ? [] : [`    check: ${check}`]),
        "",
      ].join("\n"),
      "jobs/lead.md": "Plan the work.\n",
    });
    yield* world.press({ _tag: "apply" });
    yield* world.snapshotWhere(everyCopyReady);
  });

const startRun = (world: CrewWorld, options: Partial<CrewRunOptions> = {}) =>
  world.press({ _tag: "start", ...RUN, ...options });

/** The lead's conversation, once the engine opened one. */
const leadThread = (world: CrewWorld) =>
  Effect.gen(function* () {
    yield* eventually(
      Effect.map(opened(world), (creates) => creates.some((entry) => entry.handle === "lead")),
    );
    return (yield* opened(world)).find((entry) => entry.handle === "lead")!.chat;
  });

const lastTurnText = (world: CrewWorld, thread: CrewChat) =>
  Effect.map(
    turnsSent(world),
    (turns) => turns.findLast((turn) => turn.chat === thread)?.text ?? "",
  );

/** Turns sent into the lead's conversation. */
const wakes = (world: CrewWorld, lead: CrewChat) =>
  Effect.map(turnsSent(world), (turns) => turns.filter((turn) => turn.chat === lead).length);

/** The engine woke the lead with a card that says `words`. */
const wokenWith = (world: CrewWorld, lead: CrewChat, words: string) =>
  eventually(Effect.map(lastTurnText(world, lead), (text) => text.includes(words)));

/** The lead's turn ends with `reply` as its last message. */
const leadReplies = (world: CrewWorld, thread: CrewChat, reply: string) =>
  Effect.gen(function* () {
    yield* world.turnStarts(thread);
    yield* world.says(thread, reply);
    yield* world.turnEnds(thread);
  });

const PLAN = [
  { owner: "backend", title: "Camera", brief: "Follow the player.", doneWhen: "npm test passes" },
  { owner: "backend", title: "HUD", brief: "Show the score.", dependsOn: ["Camera"] },
];

describe("CrewEngine lead", () => {
  it.live("Apply opens each crewmate's first conversation, without a turn", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        const open = yield* world.snapshotWhere((current) =>
          current.crewmates.every((mate) => mate.currentThreadId !== null),
        );
        const creates = yield* opened(world);
        assert.deepStrictEqual(
          {
            opened: yield* Effect.forEach(open.crewmates, (mate) =>
              Effect.map(
                world.sessionsWhere(mate.handle, () => true),
                (sessions) => [
                  mate.handle,
                  mate.currentThreadId ===
                    creates.find((entry) => entry.handle === mate.handle)?.chat,
                  sessions,
                ],
              ),
            ),
            turns: (yield* turnsSent(world)).length,
            worktree: creates
              .find((entry) => entry.handle === "backend")
              ?.copy?.endsWith("/.crew/backend"),
          },
          {
            opened: [
              ["lead", true, { count: 1, latest: "open", reasons: [null] }],
              ["backend", true, { count: 1, latest: "open", reasons: [null] }],
            ],
            turns: 0,
            worktree: true,
          },
        );
      }),
    ),
  );

  it.live("a message to the lead is a turn of its own, never a task", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* world.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const thread = yield* leadThread(world);
        assert.deepStrictEqual(
          [yield* lastTurnText(world, thread), (yield* world.snapshot).board.tasks],
          ["Plan it", []],
        );
      }),
    ),
  );

  it.live("crew_propose puts a plan on the board; Start queues it and only a run starts it", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* world.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* leadThread(world);
        const answer = yield* world.propose(lead, PLAN);
        const proposed = yield* world.snapshotWhere((current) => current.board.tasks.length === 2);
        yield* world.press({
          _tag: "planAccept",
          taskIds: [proposed.board.tasks[0]!.id, proposed.board.tasks[1]!.id],
        });
        const accepted = yield* world.snapshotWhere((current) =>
          current.board.tasks.every((task) => task.state === "queued"),
        );
        const beforeRun = (yield* turnsSent(world)).length;
        yield* startRun(world);
        const running = yield* world.snapshotWhere(
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun(world, { leadMayStart: true });
        yield* world.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* leadThread(world);
        yield* world.propose(lead, PLAN);
        const running = yield* world.snapshotWhere(
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun(world, { landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        const inReview = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "review",
        );
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "review @backend's work");
        const wake = yield* lastTurnText(world, lead);
        const answer = yield* world.review(lead, {
          task: 1,
          verdict: "accept",
          note: "Looks right.",
        });
        const landed = yield* world.snapshotWhere(
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
            answer: "Accepted — landing…",
            verdict: { verdict: "accept", note: "Looks right.", by: "lead" },
            tree: "ok\n",
          },
        );
      }),
    ),
  );

  it.live(
    "the rig: a review whose wake a stopped run cut off wakes the lead at the next Start; its accept moves the queue",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun(world, { budgetUsd: 3, landing: "lead" });
          const stopped = (yield* world.snapshotWhere(
            (current) => current.run?.state === "running",
          )).run!.id;
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          for (const title of ["Health check", "Metrics"]) {
            yield* world.press({
              _tag: "taskCreate",
              owner: "backend",
              title,
              brief: title,
              doneWhen: "",
              dependsOn: [],
            });
          }
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          yield* world.turnStarts(lead);
          yield* world.press({ _tag: "stop", runId: stopped });
          yield* world.turnEnds(lead, { state: "interrupted" });
          yield* world.snapshotWhere((current) => current.run?.state === "stopped");
          const before = yield* wakes(world, lead);
          yield* startRun(world, { budgetUsd: 0.5, landing: "lead" });
          yield* eventually(Effect.map(wakes(world, lead), (count) => count === before + 1));
          const waiting = (yield* world.snapshot).board.tasks.map((task) => task.state);
          yield* world.turnStarts(lead);
          yield* world.review(lead, {
            task: 1,
            verdict: "accept",
            note: "Looks right.",
          });
          yield* world.turnEnds(lead);
          const moved = yield* world.snapshotWhere(
            (current) =>
              current.board.tasks[0]?.state === "landed" &&
              current.board.tasks[1]?.state === "working",
          );
          assert.deepStrictEqual(
            {
              waiting,
              wake: (yield* lastTurnText(world, lead)).includes("review @backend's work"),
              moved: moved.board.tasks.map((task) => task.state),
            },
            {
              waiting: ["review", "queued", "queued"],
              wake: true,
              moved: ["landed", "working", "queued"],
            },
          );
        }),
      ),
  );

  it.live(
    "without a run a review left waiting names itself in Waiting on you; Land it myself lands it",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun(world, { landing: "lead" });
          const runId = (yield* world.snapshotWhere((current) => current.run?.state === "running"))
            .run!.id;
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          yield* world.turnStarts(lead);
          yield* world.press({ _tag: "stop", runId });
          yield* world.turnEnds(lead, { state: "interrupted" });
          yield* world.snapshotWhere((current) => current.run?.state === "stopped");
          // The review has waited ten minutes with nobody on it.
          const task = (yield* world.tasks)[0]!;
          yield* world.taskLastMovedAt(task.id, "2026-09-28T07:00:00.000Z");
          const movedAt = (yield* world.tasks)[0]!.movedAt;
          const waiting = yield* world.snapshotWhere((current) => current.attention.length > 0);
          yield* world.press({ _tag: "land", taskId: task.id });
          const landed = yield* world.snapshotWhere(
            (current) => current.board.tasks[0]?.state === "landed",
          );
          assert.deepStrictEqual(
            {
              waiting: waiting.attention.map((row) => [row.kind, row.handle, row.taskId, row.at]),
              review: landed.board.tasks[0]!.review,
              tree: read(world.root, "ok.txt"),
            },
            {
              // From when it last moved, as the crew keeps it.
              waiting: [["review-wait", "backend", task.id, movedAt]],
              review: { verdict: "accept", note: "", by: null },
              tree: "ok\n",
            },
          );
        }),
      ),
  );

  it.live(
    "without a run a task the review sent back names itself; asking its crewmate reworks it",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun(world, { landing: "lead" });
          const runId = (yield* world.snapshotWhere((current) => current.run?.state === "running"))
            .run!.id;
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          yield* world.press({ _tag: "stop", runId });
          yield* world.snapshotWhere((current) => current.run?.state === "stopped");
          const task = (yield* world.snapshot).board.tasks[0]!;
          yield* world.press({
            _tag: "review",
            taskId: task.id,
            verdict: "reject",
            note: "Name the file hud.ts.",
          });
          const sentBack = yield* world.snapshotWhere((current) => current.attention.length > 0);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Rework #1 after its review: Name the file hud.ts.",
            attachments: [],
          });
          const reworking = yield* world.snapshotWhere(
            (current) => current.board.tasks[0]?.state === "working",
          );
          assert.deepStrictEqual(
            {
              sentBack: sentBack.attention.map((row) => [row.kind, row.handle, row.text]),
              reworking: [reworking.board.tasks[0]!.attempts, reworking.attention],
            },
            {
              sentBack: [["sent-back", "backend", "Name the file hud.ts."]],
              reworking: [2, []],
            },
          );
        }),
      ),
  );

  it.live(
    "the rig: an accepted review of a copy with nothing of its own closes the task, and the queue moves",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* withLead(world, null);
          yield* startRun(world, { budgetUsd: 3, landing: "lead" });
          const thread = yield* firstTurn(world, () => undefined);
          yield* world.press({
            _tag: "taskCreate",
            owner: "backend",
            title: "Health check",
            brief: "Add /health.",
            doneWhen: "",
            dependsOn: [],
          });
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          // Another landing moved your tree after the check, as on the rig.
          write(world.root, "docs/person.md", "person\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "person edits"]);
          yield* world.turnStarts(lead);
          const answer = yield* world.review(lead, {
            task: 1,
            verdict: "accept",
            note: "Nothing to change.",
          });
          yield* world.turnEnds(lead);
          const closed = yield* world.snapshotWhere(
            (current) =>
              current.board.tasks[0]?.state === "landed" &&
              current.board.tasks[1]?.state === "working",
          );
          const log = yield* world.log(["closed"]);
          assert.deepStrictEqual(
            {
              answer: answer.text,
              task: [closed.board.tasks[0]!.landedCommit, closed.board.tasks[0]!.delivered],
              notDelivered: closed.landedNotDelivered,
              seams: (yield* seamsOf(world)).map(([threadId, words, payload]) => [
                threadId,
                words,
                payload,
              ]),
              log: log.map((entry) => entry.payload),
            },
            {
              answer: "Accepted — #1 had no changes, closed",
              task: [null, false],
              notDelivered: 0,
              seams: [
                [
                  thread,
                  "Task #1 closed — nothing to land",
                  { seam: "closed", taskId: closed.board.tasks[0]!.id, number: 1 },
                ],
              ],
              log: [{ task: closed.board.tasks[0]!.id, reason: "nothing to land" }],
            },
          );
        }),
      ),
  );

  it.live("Resume wakes the lead again for the review its pause interrupted", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun(world, { landing: "lead" });
        const runId = (yield* world.snapshotWhere((current) => current.run?.state === "running"))
          .run!.id;
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "review @backend's work");
        yield* world.turnStarts(lead);
        yield* world.press({ _tag: "pause", runId });
        yield* world.turnEnds(lead, { state: "interrupted" });
        yield* world.snapshotWhere((current) => current.run?.state === "paused");
        yield* world.press({ _tag: "resume", runId });
        yield* eventually(Effect.map(wakes(world, lead), (count) => count === 2));
        assert.isTrue((yield* lastTurnText(world, lead)).includes("review @backend's work"));
      }),
    ),
  );

  it.live("Start lands a ready task when the run's landing lands it", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
        yield* startRun(world, { landing: "check" });
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
        assert.strictEqual(read(world.root, "ok.txt"), "ok\n");
      }),
    ),
  );

  it.live(
    "an accepted task whose landing finds your tree moved merges again and lands, without a second review",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun(world, { landing: "lead" });
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "review @backend's work");
          write(world.root, "docs/person.md", "person\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "person edits"]);
          yield* world.turnStarts(lead);
          yield* world.review(lead, {
            task: 1,
            verdict: "accept",
            note: "Looks right.",
          });
          yield* world.turnEnds(lead);
          yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
          yield* Effect.sleep("300 millis");
          assert.deepStrictEqual(
            [
              read(world.root, "ok.txt"),
              read(world.root, "docs/person.md"),
              yield* wakes(world, lead),
            ],
            ["ok\n", "person\n", 1],
          );
        }),
      ),
  );

  // A rework that kept its accept is a state only V1's own tables can be put in.
  itV1("a task back from rework is reviewed afresh, its earlier accept gone", () =>
    v1Journey((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        const lead = yield* leadThread(world);
        yield* world.propose(lead, [PLAN[0]!]);
        const row = yield* world.v1.run(
          Effect.gen(function* () {
            const store = yield* CrewStore;
            const [row] = yield* store.assignments(CREW_ID);
            // Start with the retained rework outcome, without a merge/check still holding the copy.
            yield* store.putAssignment({
              ...row!,
              state: "rework",
              attempt: 1,
              review: { verdict: "accept", note: "Fine.", by: "lead" },
              waiting: { on: "conflict", reason: null, paths: ["ok.txt"] },
            });
            return row;
          }),
        );
        yield* world.press({ _tag: "askResolve", taskId: row!.assignment });
        const reworking = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [reworking.board.tasks[0]!.attempts, reworking.board.tasks[0]!.review],
          [2, null],
        );
        yield* startRun(world, { landing: "lead" });
        const thread = (yield* turnsSent(world)).find(
          (turn) =>
            turn.chat ===
            reworking.crewmates.find((mate) => mate.handle === "backend")!.currentThreadId,
        )!.chat;
        yield* world.turnStarts(thread);
        write(world.root, ".crew/backend/ok.txt", "ok\n");
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        const reviewed = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "review",
        );
        assert.deepStrictEqual(
          [reviewed.board.tasks[0]!.attempts, reviewed.board.tasks[0]!.review],
          [2, null],
        );
      }),
    ),
  );

  it.live("the lead's reject sends the task back to its crewmate with the note", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun(world, { landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "review");
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "review @backend's work");
        yield* world.review(lead, {
          task: 1,
          verdict: "reject",
          note: "Name the file hud.ts.",
        });
        const reworked = yield* world.snapshotWhere(
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* world.report(thread, {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.turnEnds(thread);
        const blocked = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "blocked",
        );
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "@backend asks");
        const wake = yield* lastTurnText(world, lead);
        yield* leadReplies(world, lead, "Use EUR.");
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "working");
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

  it.live(
    "a question the lead passes on reaches you at once; the next one waits on the lead again",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* world.report(thread, {
            status: "blocked",
            summary: "Which currency?",
            question: "CZK or EUR?",
          });
          yield* world.turnEnds(thread);
          const lead = yield* leadThread(world);
          yield* wokenWith(world, lead, "@backend asks");
          yield* world.report(lead, {
            status: "blocked",
            summary: "The person decides the currency.",
            question: "CZK or EUR?",
          });
          yield* world.turnEnds(lead);
          const asked = yield* world.snapshotWhere((current) => current.attention.length === 1);
          yield* world.press({
            _tag: "answer",
            handle: "backend",
            taskId: asked.attention[0]!.taskId,
            text: "EUR.",
          });
          yield* world.turnStarts(thread);
          yield* world.report(thread, {
            status: "blocked",
            summary: "Which font?",
            question: "Serif or sans?",
          });
          yield* world.turnEnds(thread);
          // The new question waits on the lead (its wake keeps two minutes from the last), not on you.
          assert.deepStrictEqual(
            [
              asked.attention.map((row) => [row.kind, row.handle, row.text]),
              (yield* world.snapshotWhere(
                (current) => current.board.tasks[0]?.question === "Serif or sans?",
              )).attention,
            ],
            [[["question", "backend", "CZK or EUR?"]], []],
          );
        }),
      ),
  );

  it.live("the lead's own question waits on you, and your answer reaches the lead", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* world.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
        const lead = yield* leadThread(world);
        yield* world.report(lead, {
          status: "blocked",
          summary: "Mobile first?",
        });
        yield* world.turnEnds(lead);
        const asked = yield* world.snapshotWhere((current) => current.attention.length === 1);
        yield* world.press({
          _tag: "answer",
          handle: "lead",
          taskId: null,
          text: "Desktop first.",
        });
        const answered = yield* world.snapshotWhere((current) => current.attention.length === 0);
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun(world);
        yield* world.press({ _tag: "message", handle: "lead", text: "Wrap up", attachments: [] });
        const answer = yield* world.finish(yield* leadThread(world), {
          summary: "Every Done when line is met.",
        });
        const finished = yield* world.snapshotWhere((current) => current.run?.state === "finished");
        assert.deepStrictEqual(
          [answer.text, finished.run!.state],
          ["The run is finished.", "finished"],
        );
      }),
    ),
  );

  it.live(
    "a restart wakes the lead again for a pending review only two minutes after its last wake",
    () => {
      let before = 0;
      return crewJourney([
        (world) =>
          Effect.gen(function* () {
            yield* withLead(world);
            yield* startRun(world, { landing: "lead" });
            const thread = yield* firstTurn(world, () =>
              write(world.root, ".crew/backend/ok.txt", "ok\n"),
            );
            yield* reportDone(world, thread);
            yield* world.turnEnds(thread);
            yield* wokenWith(world, yield* leadThread(world), "review @backend's work");
            before = yield* wakes(world, yield* leadThread(world));
          }),
        (world) =>
          Effect.gen(function* () {
            yield* world.serverReady;
            yield* world.snapshotWhere((current) => current.run?.state === "running");
            yield* Effect.sleep("500 millis");
            assert.deepStrictEqual([before, yield* wakes(world, yield* leadThread(world))], [1, 1]);
          }),
      ]);
    },
  );

  it.live("a person's own turn to the lead in a run keeps its row after a restart", () =>
    crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* startRun(world);
          yield* world.snapshotWhere((current) => current.run?.state === "running");
          yield* world.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
          yield* leadThread(world);
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          const kept = yield* world.snapshotWhere((current) =>
            current.attention.some((need) => need.kind === "interrupted" && need.handle === "lead"),
          );
          yield* Effect.sleep("300 millis");
          const still = yield* world.snapshotWhere(() => true);
          assert.isTrue(
            still.attention.some(
              (need) =>
                need.kind === "interrupted" &&
                need.operation?.id ===
                  kept.attention.find((row) => row.kind === "interrupted")!.operation!.id,
            ),
          );
        }),
    ]),
  );

  it.live("the lead's own question still waits on you after a restart", () =>
    crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          yield* world.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
          const lead = yield* leadThread(world);
          yield* world.report(lead, {
            status: "blocked",
            summary: "Mobile first?",
          });
          yield* world.snapshotWhere((current) => current.attention.length === 1);
        }),
      (world) =>
        Effect.gen(function* () {
          const waiting = yield* world.snapshotWhere((current) =>
            current.attention.some((need) => need.kind === "question"),
          );
          assert.deepStrictEqual(
            waiting.attention
              .filter((row) => row.kind === "question")
              .map((row) => [row.kind, row.handle, row.text]),
            [["question", "lead", "Mobile first?"]],
          );
          // V1 records the restart's cut as an operation the answer continues: its own mechanism.
          const interruption = waiting.attention.find(
            (need) => need.kind === "interrupted",
          )?.operation;
          yield* world.press({
            _tag: "answer",
            handle: "lead",
            taskId: null,
            text: "Mobile first.",
          });
          yield* onV1(world, (v1) =>
            Effect.gen(function* () {
              const settled = yield* v1.v1.run(
                Effect.flatMap(CrewStore, (store) => store.getOperation(interruption!.id)),
              );
              assert.strictEqual(
                settled._tag === "Some" ? settled.value.status : null,
                "continued",
              );
            }).pipe(Effect.orDie),
          );
        }),
    ]),
  );

  it.live("the lead's wakes stand at least two minutes apart", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        yield* startRun(world, { landing: "lead" });
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* world.report(thread, {
          status: "blocked",
          summary: "Which currency?",
          question: "CZK or EUR?",
        });
        yield* world.turnEnds(thread);
        const lead = yield* leadThread(world);
        yield* wokenWith(world, lead, "@backend asks");
        yield* leadReplies(world, lead, "Use EUR.");
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "working");
        yield* world.turnStarts(thread);
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "review");
        yield* Effect.sleep("500 millis");
        const wakes = (yield* turnsSent(world)).filter((turn) => turn.chat === lead);
        assert.strictEqual(wakes.length, 1);
      }),
    ),
  );
});
