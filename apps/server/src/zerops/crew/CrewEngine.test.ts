// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { CrewSnapshot, OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ZEROPS_SUBJECT_PREFIX } from "../ZeropsMembershipWatch.ts";
import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { CrewEngine } from "./CrewEngine.ts";
import { CrewThreadDirectory, CrewToolHost } from "./crewSeams.ts";
import {
  eventually,
  runningPersonThread,
  spiEvent,
  withCrewEngine,
  writeCrewHome,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import { git, read, write } from "./testing/crewGitFixture.ts";

const KAREL: TurnPrincipal = { kind: "session", subject: `${ZEROPS_SUBJECT_PREFIX}user-karel` };

const latest = Effect.flatMap(CrewEngine, (engine) =>
  engine.snapshot.pipe(Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow)),
);

const command = (input: Parameters<CrewEngine["Service"]["command"]>[0]) =>
  Effect.flatMap(CrewEngine, (engine) => engine.command(input, KAREL));

const dispatchedOf = <T extends OrchestrationCommand["type"]>(world: CrewWorld, type: T) =>
  Effect.map(Ref.get(world.dispatched), (all) =>
    all.filter(
      (entry): entry is Extract<OrchestrationCommand, { readonly type: T }> => entry.type === type,
    ),
  );

const everyCopyReady = (snapshot: CrewSnapshot) =>
  snapshot.status === "applied" &&
  snapshot.crewmates.every((mate) => mate.readOnly || mate.lane?.state === "ready");

/** Applies the crew home and waits until every copy is ready. */
const applied = (world: CrewWorld) =>
  Effect.gen(function* () {
    writeCrewHome(world.workspace);
    yield* command({ _tag: "apply" });
    yield* eventually(Effect.map(latest, everyCopyReady));
  });

const snapshotWhere = (check: (snapshot: CrewSnapshot) => boolean) =>
  Effect.gen(function* () {
    yield* eventually(Effect.map(latest, check));
    return yield* latest;
  });

describe("CrewEngine", () => {
  it.live("with no crew applied: status none, no policy installed", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const snapshot = yield* latest;
        assert.deepStrictEqual(
          [snapshot.status, snapshot.crew, yield* Ref.get(world.installs)],
          ["none", null, 0],
        );
        const error = yield* Effect.flip(
          command({ _tag: "message", handle: "backend", text: "hi", attachments: [] }),
        );
        assert.strictEqual(error.reason, "no-crew");
      }),
    ),
  );

  it.live("Apply makes each writer's copy, installs the policies once and shows the crew", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const snapshot = yield* latest;
        const backend = snapshot.crewmates[0]!;
        assert.deepStrictEqual(
          {
            status: snapshot.status,
            crew: snapshot.crew?.name,
            handle: backend.handle,
            lane: backend.lane?.state,
            branch: git(world.root, ["rev-parse", "--abbrev-ref", "crew/backend"]),
            copy: NodeFS.existsSync(NodePath.join(world.root, ".crew/backend/README.md")),
            installs: yield* Ref.get(world.installs),
            versions: backend.promptVersions,
          },
          {
            status: "applied",
            crew: "Game team",
            handle: "backend",
            lane: "ready",
            branch: "crew/backend",
            copy: true,
            installs: 1,
            versions: { running: null, current: { brief: 1, job: 1 } },
          },
        );
      }),
    ),
  );

  it.live(
    "a message to an idle crewmate opens one implicit task and a stint; a second steers it",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({
            _tag: "message",
            handle: "backend",
            text: "Add pagination to /api/items\nCursor based.",
            attachments: [],
          });
          const created = yield* dispatchedOf(world, "thread.crew.create");
          const resume = yield* dispatchedOf(world, "thread.usage-auto-resume.set");
          const turns = yield* dispatchedOf(world, "thread.turn.start");
          assert.deepStrictEqual(
            {
              runtimeMode: created[0]?.runtimeMode,
              crew: created[0]?.crew,
              autoResume: resume.map((entry) => [entry.threadId, entry.enabled]),
              turnThread: turns[0]?.threadId,
              card: turns[0]?.message.text.split("\n").slice(0, 2),
              instance: turns[0]?.modelSelection?.instanceId,
              turnMode: turns[0]?.runtimeMode,
            },
            {
              runtimeMode: "approval-required",
              crew: { crew: "main", crewmate: "backend", stint: 1 },
              autoResume: [[created[0]!.threadId, false]],
              turnThread: created[0]!.threadId,
              card: ["[Crew task card]", "#1 Add pagination to /api/items · from your message"],
              instance: "claudeAgent",
              turnMode: "approval-required",
            },
          );
          yield* world.publish(spiEvent("turn.started", created[0]!.threadId, {}));
          yield* eventually(
            Effect.map(latest, (snapshot) => snapshot.crewmates[0]!.stints[0]?.state === "active"),
          );
          yield* command({
            _tag: "message",
            handle: "backend",
            text: "Also sort them.",
            attachments: [],
          });
          const snapshot = yield* snapshotWhere((current) => current.board.tasks.length === 1);
          assert.deepStrictEqual(
            {
              tasks: snapshot.board.tasks.map((task) => [
                task.number,
                task.title,
                task.state,
                task.source,
              ]),
              open: snapshot.crewmates[0]!.openTaskId === snapshot.board.tasks[0]!.id,
              turns: (yield* dispatchedOf(world, "thread.turn.start")).map(
                (turn) => turn.message.text.split("\n")[0],
              ),
              principals: (yield* Ref.get(world.admitted)).map((entry) => entry.principal),
            },
            {
              tasks: [[1, "Add pagination to /api/items", "working", "message"]],
              open: true,
              turns: ["[Crew task card]", "Also sort them."],
              principals: [KAREL, KAREL, KAREL],
            },
          );
        }),
      ),
  );

  it.live(
    "turn end commits the copy's work; a done report merges in, checks and waits for Land",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({
            _tag: "message",
            handle: "backend",
            text: "Write ok.txt",
            attachments: [],
          });
          const [created] = yield* dispatchedOf(world, "thread.crew.create");
          const thread = created!.threadId;
          yield* world.publish(spiEvent("turn.started", thread, {}));
          write(world.root, ".crew/backend/ok.txt", "ok\n");
          const directory = yield* CrewThreadDirectory;
          const host = yield* CrewToolHost;
          const member = Option.getOrThrow(yield* directory.memberFor(thread));
          const answer = yield* host.report(member, { status: "done", summary: "Wrote ok.txt." });
          assert.isFalse(answer.isError);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const ready = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "ready",
          );
          assert.deepStrictEqual(
            {
              wip: git(world.root, ["log", "-1", "--format=%s", "crew/backend"]).startsWith("wip("),
              check: ready.board.tasks[0]!.check?.state,
              attention: ready.attention.map((row) => row.kind),
              report: ready.board.tasks[0]!.report,
            },
            { wip: true, check: "passed", attention: ["ready-to-land"], report: "Wrote ok.txt." },
          );
          yield* Ref.set(world.threads, [runningPersonThread()]);
          const waits = yield* Effect.flip(
            command({ _tag: "land", taskId: ready.board.tasks[0]!.id }),
          );
          assert.strictEqual(waits.reason, "wrong-state");
          yield* Ref.set(world.threads, []);
          yield* command({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          const landed = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "landed",
          );
          const message = git(world.root, ["log", "-1", "--format=%B", "HEAD"]);
          assert.deepStrictEqual(
            {
              file: read(world.root, "ok.txt"),
              trailers:
                message.includes("Crew-Lane: backend") &&
                message.includes(`Crew-Assignment: ${landed.board.tasks[0]!.id}`),
              landedCommit:
                landed.board.tasks[0]!.landedCommit === git(world.root, ["rev-parse", "HEAD"]),
              notDelivered: landed.landedNotDelivered,
            },
            { file: "ok\n", trailers: true, landedCommit: true, notDelivered: 1 },
          );
        }),
      ),
  );

  it.live("a task for a busy crewmate queues and starts as its creator when the first lands", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({ _tag: "message", handle: "backend", text: "First", attachments: [] });
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Second",
          brief: "Do the second thing.",
          doneWhen: "",
          dependsOn: [],
        });
        const queued = yield* snapshotWhere((snapshot) => snapshot.board.tasks.length === 2);
        assert.deepStrictEqual(
          queued.board.tasks.map((task) => [task.title, task.state]),
          [
            ["First", "working"],
            ["Second", "queued"],
          ],
        );
        const [stint] = yield* dispatchedOf(world, "thread.crew.create");
        yield* world.publish(spiEvent("turn.completed", stint!.threadId, { state: "completed" }));
        yield* eventually(
          command({ _tag: "discard", taskId: queued.board.tasks[0]!.id }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        );
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[1]?.state === "working");
        const admitted = yield* Ref.get(world.admitted);
        assert.deepStrictEqual(admitted.at(-1)?.principal, {
          kind: "crew",
          startedBy: "user-karel",
        });
      }),
    ),
  );

  it.live("a queued task admission refuses stays queued with a Can't start row", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* Ref.set(world.refusal, "not the login's signer");
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Refused",
          brief: "Try it.",
          doneWhen: "",
          dependsOn: [],
        });
        const snapshot = yield* snapshotWhere((current) => current.attention.length === 1);
        assert.deepStrictEqual(
          [snapshot.board.tasks[0]?.state, snapshot.attention.map((row) => [row.kind, row.text])],
          ["queued", [["cant-start", "not the login's signer"]]],
        );
        yield* Ref.set(world.refusal, undefined);
        yield* command({ _tag: "taskRetry", taskId: snapshot.board.tasks[0]!.id });
        yield* snapshotWhere((current) => current.board.tasks[0]?.state === "working");
      }),
    ),
  );

  it.live("Tell the crew: one mention a task, none refused", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        writeCrewHome(world.workspace, {
          "crew.yaml": [
            "name: Game team",
            "briefTitle: Space shooter",
            "members:",
            "  - handle: backend",
            "    displayName: Backend",
            "    host: appdev",
            "  - handle: erik",
            "    displayName: Erik",
            "    kind: reader",
            "",
          ].join("\n"),
          "jobs/erik.md": "You write the plan.\n",
        });
        yield* command({ _tag: "apply" });
        yield* eventually(Effect.map(latest, everyCopyReady));
        const none = yield* Effect.flip(
          command({ _tag: "tell", text: "Everyone, go.", mentions: [] }),
        );
        yield* command({
          _tag: "tell",
          text: "@backend adds the API, @erik reviews the plan.",
          mentions: [{ handle: "backend" }, { handle: "erik" }],
        });
        const snapshot = yield* snapshotWhere((current) => current.board.tasks.length === 2);
        assert.deepStrictEqual(
          {
            none: none.reason,
            tasks: snapshot.board.tasks.map((task) => [task.owner, task.title, task.state]),
          },
          {
            none: "no-mention",
            tasks: [
              ["backend", "@backend adds the API", "working"],
              ["erik", "@erik reviews the plan", "working"],
            ],
          },
        );
        const cards = (yield* dispatchedOf(world, "thread.turn.start")).map(
          (turn) => turn.message.text,
        );
        assert.isTrue(cards.every((card) => card.includes("Also sent to")));
      }),
    ),
  );

  it.live("a job saved for the next turn rotates the stint before that turn", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
        const [first] = yield* dispatchedOf(world, "thread.crew.create");
        yield* world.publish(spiEvent("turn.completed", first!.threadId, { state: "completed" }));
        yield* eventually(
          Effect.map(latest, (snapshot) => snapshot.crewmates[0]!.lane?.ahead === 0),
        );
        writeCrewHome(world.workspace, {
          "jobs/backend.md": "You own the server and its tests.\n",
        });
        yield* command({ _tag: "jobSave", handle: "backend", apply: "nextTurn" });
        const pending = (yield* snapshotWhere((current) => current.crewmates[0]!.jobVersion === 2))
          .crewmates[0]!.promptVersions;
        yield* command({ _tag: "message", handle: "backend", text: "Go on", attachments: [] });
        const creates = yield* dispatchedOf(world, "thread.crew.create");
        const snapshot = yield* snapshotWhere(
          (current) => current.crewmates[0]!.stints.length === 2,
        );
        assert.deepStrictEqual(
          {
            pending,
            archived: (yield* dispatchedOf(world, "thread.archive")).map((entry) => entry.threadId),
            stopped: (yield* dispatchedOf(world, "thread.session.stop")).map(
              (entry) => entry.threadId,
            ),
            stints: creates.map((entry) => entry.crew.stint),
            reason: snapshot.crewmates[0]!.stints.map((stint) => [stint.state, stint.reason]),
            running: snapshot.crewmates[0]!.promptVersions.running,
          },
          {
            pending: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 2 } },
            archived: [first!.threadId],
            stopped: [first!.threadId],
            stints: [1, 2],
            reason: [
              ["retired", null],
              ["open", "prompt-changed"],
            ],
            running: { brief: 1, job: 2 },
          },
        );
      }),
    ),
  );
});
