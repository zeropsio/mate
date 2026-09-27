// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  ThreadId as ThreadIdSchema,
  type CrewSnapshot,
  type OrchestrationCommand,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { MateLogin } from "../ZeropsLogins.ts";
import { ZEROPS_SUBJECT_PREFIX } from "../ZeropsMembershipWatch.ts";
import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { ServerCommandReadiness } from "../../spi/serverCommandReadiness.ts";
import { ThreadToolPolicyRegistry } from "../../spi/threadToolPolicy.ts";
import { CrewEngine } from "./CrewEngine.ts";
import { DEV_SERVER_PIDFILE } from "./CrewRuntime.ts";
import { CrewThreadDirectory, CrewToolHost } from "./crewSeams.ts";
import { installCrewThreadPolicy } from "./CrewThreadPolicy.ts";
import {
  eventually,
  runningPersonThread,
  spiEvent,
  withCrewEngine,
  withCrewEngines,
  writeCrewHome,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import { TEST_HOST, git, read, write } from "./testing/crewGitFixture.ts";

const mateLogin = (id: string, agent: "claude-code" | "codex", label: string): MateLogin => ({
  id,
  agent,
  kind: "subscription",
  label,
  home: `/home/zerops/.mate/logins/${id}`,
  keyStored: false,
});

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
          const member = Option.getOrThrow(
            yield* (yield* CrewThreadDirectory).memberFor(created[0]!.threadId),
          );
          const seed = yield* (yield* CrewToolHost).sessionStart(member, {
            source: "startup",
            sessionId: "session-1",
            transcriptPath: "/home/zerops/.claude/projects/x/session-1.jsonl",
          });
          assert.isUndefined(seed);
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
            carried: (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.message.text,
          },
          {
            pending: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 2 } },
            archived: [first!.threadId],
            stopped: [first!.threadId],
            stints: [1, 2],
            reason: [
              ["retired", null],
              ["open", "Job updated to v2 — applies from here"],
            ],
            running: { brief: 1, job: 2 },
            carried: [
              "[Crew task card]",
              "#1 Start · continues",
              "Job updated to v2 — applies from here",
              "",
              "Go on",
            ].join("\n"),
          },
        );
      }),
    ),
  );

  /** Opens a task with a message and ends its first turn with `edit` made in the copy. */
  const firstTurn = (world: CrewWorld, edit: () => void) =>
    Effect.gen(function* () {
      yield* command({ _tag: "message", handle: "backend", text: "Change a.txt", attachments: [] });
      const [created] = yield* dispatchedOf(world, "thread.crew.create");
      const thread = created!.threadId;
      yield* world.publish(spiEvent("turn.started", thread, {}));
      edit();
      return thread;
    });

  const reportDone = (thread: ThreadId) =>
    Effect.gen(function* () {
      const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(thread));
      yield* (yield* CrewToolHost).report(member, { status: "done", summary: "Done." });
    });

  it.live("refs the engine writes mid-turn never park the lane; a foreign one does", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          git(world.root, ["update-ref", "refs/t3/crew-state/main", "HEAD"]),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* eventually(
          Effect.map(latest, (snapshot) => snapshot.crewmates[0]!.lane?.ahead === 0),
        );
        yield* Effect.sleep("300 millis");
        assert.strictEqual((yield* latest).board.tasks[0]?.state, "working");
        yield* command({ _tag: "message", handle: "backend", text: "More", attachments: [] });
        git(world.root, ["update-ref", "refs/heads/crewmate-made-this", "HEAD"]);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const parked = yield* snapshotWhere(
          (snapshot) => snapshot.board.tasks[0]?.state === "parked",
        );
        assert.strictEqual(
          parked.board.tasks[0]!.reason,
          "a ref changed outside the engine: refs/heads/crewmate-made-this",
        );
      }),
    ),
  );

  it.live(
    "a merge-in conflict goes back naming the files; Ask to resolve sends one turn as you",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          write(world.root, "a.txt", "base\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "a.txt"]);
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/a.txt", "crew\n"),
          );
          write(world.root, "a.txt", "person\n");
          git(world.root, ["commit", "-q", "-am", "person edits a.txt"]);
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const rework = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "rework",
          );
          assert.deepStrictEqual(
            {
              reason: rework.board.tasks[0]!.reason,
              attention: rework.attention.map((row) => [row.kind, row.paths]),
              lane: rework.crewmates[0]!.lane?.state,
            },
            {
              reason: "conflicts with what landed",
              attention: [["conflict", ["a.txt"]]],
              lane: "conflicts",
            },
          );
          yield* command({ _tag: "askResolve", taskId: rework.board.tasks[0]!.id });
          const turns = yield* dispatchedOf(world, "thread.turn.start");
          const resolving = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "working",
          );
          assert.deepStrictEqual(
            {
              card: turns.at(-1)!.message.text.split("\n").slice(1, 3),
              attempts: resolving.board.tasks[0]!.attempts,
              principal: (yield* Ref.get(world.admitted)).at(-1)?.principal,
            },
            {
              card: [
                "#1 Change a.txt · resolve the conflicts",
                "Merging your tree's head into your copy stopped on conflicts in:",
              ],
              attempts: 2,
              principal: KAREL,
            },
          );
        }),
      ),
  );

  it.live("Land now on a crewmate that never reported: WIP, merge-in, check and land", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/ok.txt", "ok\n"),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const working = yield* snapshotWhere(
          (snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1,
        );
        yield* command({ _tag: "landNow", taskId: working.board.tasks[0]!.id });
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "landed");
        assert.strictEqual(read(world.root, "ok.txt"), "ok\n");
      }),
    ),
  );

  it.live(
    "a failed check goes back as rework; a landing refused by your edit waits on your tree",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/b.txt", "crew\n"),
          );
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const failed = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "rework",
          );
          assert.deepStrictEqual(
            [failed.board.tasks[0]!.check?.state, failed.attention.map((row) => row.kind)],
            ["failed", ["check-failed"]],
          );
          yield* command({ _tag: "askFix", taskId: failed.board.tasks[0]!.id });
          write(world.root, ".crew/backend/ok.txt", "ok\n");
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const ready = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "ready",
          );
          write(world.root, "b.txt", "the person's own edit\n");
          yield* command({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          const waiting = yield* snapshotWhere(
            (snapshot) => snapshot.board.tasks[0]?.state === "waiting-on-you",
          );
          assert.deepStrictEqual(
            [
              waiting.board.tasks[0]!.waitingOn,
              waiting.attention.map((row) => [row.kind, row.paths]),
            ],
            [["b.txt"], [["landing-wait", ["b.txt"]]]],
          );
        }),
      ),
  );

  it.live("Land now takes a task back from rework as its copy stands", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/b.txt", "crew\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const failed = yield* snapshotWhere(
          (snapshot) => snapshot.board.tasks[0]?.state === "rework",
        );
        write(world.root, ".crew/backend/ok.txt", "ok\n");
        yield* command({ _tag: "landNow", taskId: failed.board.tasks[0]!.id });
        yield* snapshotWhere((snapshot) => snapshot.board.tasks[0]?.state === "landed");
        assert.deepStrictEqual(
          [read(world.root, "b.txt"), read(world.root, "ok.txt")],
          ["crew\n", "ok\n"],
        );
      }),
    ),
  );

  it.live("a self-deploy onto the service freezes its copies and interrupts their turns", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* world.publish(
          spiEvent(
            "item.started",
            "person-thread",
            { itemType: "mcp_tool_call", status: "inProgress" } as never,
            {
              itemId: "deploy-1",
              toolCall: {
                name: "zerops_deploy",
                rawName: "mcp__zerops__zerops_deploy",
                server: "zerops",
                arguments: { targetService: "appdev" },
              },
            } as never,
          ),
        );
        const frozen = yield* snapshotWhere(
          (snapshot) => snapshot.crewmates[0]!.lane?.state === "frozen",
        );
        const interrupts = yield* dispatchedOf(world, "thread.turn.interrupt");
        assert.deepStrictEqual(
          [frozen.crewmates[0]!.lane?.state, interrupts.map((entry) => entry.threadId)],
          ["frozen", [thread]],
        );
      }),
    ),
  );

  it.live(
    "after a restart: policies install at once, the sweep waits for readiness, a died turn re-queues",
    () => {
      let turnsBefore = 0;
      return withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* command({
              _tag: "message",
              handle: "backend",
              text: "Long work",
              attachments: [],
            });
            const [created] = yield* dispatchedOf(world, "thread.crew.create");
            yield* Ref.set(world.threads, [
              { ...runningPersonThread(), id: created!.threadId, crew: created!.crew },
            ]);
            turnsBefore = (yield* dispatchedOf(world, "thread.turn.start")).length;
          }),
        (world) =>
          Effect.gen(function* () {
            assert.strictEqual(yield* Ref.get(world.installs), 2);
            yield* Effect.sleep("300 millis");
            assert.strictEqual(
              (yield* dispatchedOf(world, "thread.turn.start")).length,
              turnsBefore,
            );
            yield* (yield* ServerCommandReadiness).complete;
            const snapshot = yield* snapshotWhere(
              (current) =>
                current.board.tasks[0]?.attempts === 2 &&
                current.board.tasks[0]?.state === "working",
            );
            assert.deepStrictEqual(
              [
                (yield* dispatchedOf(world, "thread.turn.start")).length,
                (yield* Ref.get(world.admitted)).at(-1)?.principal,
                snapshot.lastError,
              ],
              [turnsBefore + 1, { kind: "crew", startedBy: "user-karel" }, null],
            );
            const thread = snapshot.crewmates[0]!.currentThreadId!;
            const member = yield* (yield* CrewThreadDirectory).memberFor(thread);
            assert.isTrue(Option.getOrThrow(member).live);
          }),
      ]);
    },
  );

  it.live("a subscription reads the tables only: the feed opens no ssh", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* eventually(
          Effect.gen(function* () {
            const settled = yield* Ref.get(world.sshCalls);
            yield* Effect.sleep("200 millis");
            return settled === (yield* Ref.get(world.sshCalls));
          }),
        );
        const before = yield* Ref.get(world.sshCalls);
        const engine = yield* CrewEngine;
        const frames = yield* engine.snapshot.pipe(Stream.take(1), Stream.runCollect);
        assert.deepStrictEqual([frames.length, (yield* Ref.get(world.sshCalls)) - before], [1, 0]);
      }),
    ),
  );

  it.live("with no crew applied the engine opens no ssh at all", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        const engine = yield* CrewEngine;
        yield* engine.snapshot.pipe(Stream.take(1), Stream.runCollect);
        yield* Effect.sleep("300 millis");
        assert.strictEqual(yield* Ref.get(world.sshCalls), 0);
      }),
    ),
  );

  it.live(
    "Start fresh rotates between turns; Save and apply now interrupts, rotates and continues",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const busy = yield* Effect.flip(command({ _tag: "startFresh", handle: "backend" }));
          writeCrewHome(world.workspace, { "brief.md": "Ship it by Friday.\n" });
          yield* command({ _tag: "briefSave", apply: "now" });
          const interrupts = (yield* dispatchedOf(world, "thread.turn.interrupt")).map(
            (entry) => entry.threadId,
          );
          yield* world.publish(spiEvent("turn.completed", thread, { state: "interrupted" }));
          yield* eventually(
            Effect.map(
              dispatchedOf(world, "thread.crew.create"),
              (creates) => creates.length === 2,
            ),
          );
          yield* eventually(
            Effect.map(dispatchedOf(world, "thread.turn.start"), (turns) =>
              turns.at(-1)!.message.text.includes("· continue"),
            ),
          );
          const continued = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
          const creates = yield* dispatchedOf(world, "thread.crew.create");
          yield* world.publish(
            spiEvent("turn.completed", continued.threadId, { state: "completed" }),
          );
          yield* eventually(
            command({ _tag: "startFresh", handle: "backend" }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          );
          const snapshot = yield* snapshotWhere(
            (current) => current.crewmates[0]!.stints.length === 3,
          );
          assert.deepStrictEqual(
            {
              busy: busy.reason,
              interrupts,
              continueIn: continued.threadId === creates[1]!.threadId,
              continueAs: (yield* Ref.get(world.admitted)).at(-1)?.principal,
              reasons: snapshot.crewmates[0]!.stints.map((stint) => stint.reason),
              brief: snapshot.crew?.briefVersion,
            },
            {
              busy: "wrong-state",
              interrupts: [thread],
              continueIn: true,
              continueAs: { kind: "crew", startedBy: "user-karel" },
              reasons: [null, "Brief updated to v2 — applies from here", "Started fresh by you"],
              brief: 2,
            },
          );
        }),
      ),
  );

  it.live("a changed login saves only as fresh; the section names it by its label", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* Ref.set(
          world.logins,
          new Map([["claudeAgent_work", mateLogin("claudeAgent_work", "claude-code", "work")]]),
        );
        writeCrewHome(world.workspace, {
          "crew.yaml": [
            "name: Game team",
            "briefTitle: Space shooter",
            "members:",
            "  - handle: backend",
            "    displayName: Backend",
            "    host: appdev",
            "    login: claudeAgent_work",
            "",
          ].join("\n"),
        });
        const refused = yield* Effect.flip(
          command({ _tag: "jobSave", handle: "backend", apply: "nextTurn" }),
        );
        yield* command({ _tag: "jobSave", handle: "backend", apply: "fresh" });
        const snapshot = yield* snapshotWhere(
          (current) => current.crewmates[0]!.login.id === "claudeAgent_work",
        );
        assert.deepStrictEqual(
          [refused.reason, snapshot.crewmates[0]!.login],
          ["login-needs-fresh", { id: "claudeAgent_work", label: "work", agent: "claude-code" }],
        );
      }),
    ),
  );

  it.live("Remove from crew keeps a copy with unlanded work until Discard", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/x.txt", "x\n"),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        yield* eventually(
          Effect.map(latest, (snapshot) => snapshot.crewmates[0]!.lane?.ahead === 1),
        );
        const kept = yield* Effect.flip(
          command({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: false }),
        );
        yield* command({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: true });
        const snapshot = yield* snapshotWhere((current) => current.crewmates.length === 0);
        assert.deepStrictEqual(
          {
            kept: kept.reason,
            copy: NodeFS.existsSync(NodePath.join(world.root, ".crew/backend")),
            task: snapshot.board.tasks[0]?.state,
            home: read(world.workspace, ".mate/crew/main/crew.yaml").includes("backend"),
          },
          { kept: "unlanded-commits", copy: false, task: "discarded", home: false },
        );
      }),
    ),
  );

  it.live(
    "crew ports: Apply gives each writer one, Run and Stop its app, Add crew ports proposes more",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          write(
            world.root,
            "zerops.yaml",
            [
              "zerops:",
              "  - setup: appdev",
              "    run:",
              "      ports:",
              "        - port: 3000",
              "          httpSupport: true",
              "        - port: 3001",
              "          httpSupport: true",
              "",
            ].join("\n"),
          );
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
          writeCrewHome(world.workspace, {
            "crew.yaml": [
              "name: Game team",
              "briefTitle: Space shooter",
              "members:",
              "  - handle: backend",
              "    displayName: Backend",
              "    host: appdev",
              "    run: sleep 30",
              "",
            ].join("\n"),
          });
          yield* command({ _tag: "apply" });
          yield* eventually(Effect.map(latest, everyCopyReady));
          const ports = yield* command({ _tag: "addCrewPorts", host: "appdev", count: 2 });
          yield* command({ _tag: "appRun", handle: "backend" });
          const running = yield* snapshotWhere(
            (current) => current.crewmates[0]!.app?.state === "running",
          );
          yield* command({ _tag: "appStop", handle: "backend" });
          const stopped = yield* snapshotWhere(
            (current) => current.crewmates[0]!.app?.state === "stopped",
          );
          assert.deepStrictEqual(
            {
              hosts: running.hosts.map((host) => [host.host, host.crewPorts]),
              app: running.crewmates[0]!.app,
              stopped: stopped.crewmates[0]!.app?.state,
              ports,
            },
            {
              hosts: [["appdev", [{ port: 3001, routed: null }]]],
              app: { state: "running", port: 3001, url: null },
              stopped: "stopped",
              ports: { _tag: "crewPorts", host: "appdev", ports: [3002, 3003] },
            },
          );
        }),
      ),
  );

  it.live(
    "Deliver's draft names your tree's uncommitted paths; the orphan scan finds lost branches",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          write(world.root, "notes.txt", "mine\n");
          git(world.root, ["branch", "crew/ghost"]);
          git(world.root, ["commit", "-q", "--allow-empty", "-m", "ahead of ghost"]);
          const draft = yield* command({ _tag: "deliverDraft" });
          const orphans = yield* command({ _tag: "orphanScan" });
          assert.deepStrictEqual(
            [draft, orphans],
            [
              { _tag: "deliverDraft", dirtyPaths: [`${world.root}/notes.txt`] },
              { _tag: "orphans", orphans: [{ host: "appdev", branch: "crew/ghost", ahead: 0 }] },
            ],
          );
        }),
      ),
  );

  /** zcp's dev server, faked: a process started in `cwd` whose pid is in zcp's pidfile. */
  const startDevServer = (cwd: string) => {
    const child = NodeChildProcess.spawn("sleep", ["60"], { cwd, detached: true, stdio: "ignore" });
    child.unref();
    NodeFS.writeFileSync(DEV_SERVER_PIDFILE, `${child.pid}\n`);
    return child.pid!;
  };

  it.live(
    "Show on dev: request, Allow sends the claim turn, dev serving the copy holds it, Back to my tree releases",
    () => {
      const started: Array<number> = [];
      return withCrewEngine((world) =>
        Effect.gen(function* () {
          write(
            world.root,
            "zerops.yaml",
            "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
          );
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
          yield* applied(world);
          started.push(startDevServer(world.root));
          const thread = yield* firstTurn(world, () => undefined);
          const directory = yield* CrewThreadDirectory;
          const member = Option.getOrThrow(yield* directory.memberFor(thread));
          const asked = yield* (yield* CrewToolHost).showOnDev(member, { reason: "see the HUD" });
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const requested = yield* snapshotWhere((snapshot) =>
            snapshot.attention.some((row) => row.kind === "show-on-dev"),
          );
          yield* eventually(
            command({ _tag: "claimGrant", host: "appdev" }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
          );
          const claimTurn = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
          const shaped = Option.getOrThrow(yield* directory.memberFor(thread)).gate;
          started.push(startDevServer(NodePath.join(world.root, ".crew/backend")));
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const held = yield* snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "held",
          );
          const gate = Option.getOrThrow(yield* directory.memberFor(thread)).gate;
          const blocked = yield* Effect.flip(
            command({ _tag: "landNow", taskId: held.board.tasks[0]!.id }),
          );
          yield* command({ _tag: "claimRelease", host: "appdev" });
          const releaseTurn = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!;
          started.push(startDevServer(world.root));
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const released = yield* snapshotWhere(
            (snapshot) => snapshot.hosts[0]?.claim.state === "none",
          );
          assert.deepStrictEqual(
            {
              asked: asked.isError,
              attention: requested.attention
                .filter((row) => row.kind === "show-on-dev")
                .map((row) => [row.host, row.text]),
              claimCard: claimTurn.message.text.split("\n")[1],
              claimWorkDir: claimTurn.message.text.includes(`workDir=${world.root}/.crew/backend`),
              shaped: shaped.kind === "live" ? [shaped.turn, shaped.devServer?.port] : null,
              served: held.hosts[0]!.served,
              holdsClaim: gate.kind === "live" && gate.holdsClaim,
              blocked: blocked.reason,
              releaseCard: releaseTurn.message.text.split("\n")[1],
              servedAfter: released.hosts[0]!.served,
            },
            {
              asked: false,
              attention: [["appdev", "see the HUD"]],
              claimCard: "Show your work on appdev",
              claimWorkDir: true,
              shaped: ["claim-start", 3000],
              served: { by: "crewmate", handle: "backend" },
              holdsClaim: true,
              blocked: "wrong-state",
              releaseCard: "Give appdev back",
              servedAfter: { by: "tree" },
            },
          );
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const pid of started) {
              try {
                process.kill(pid);
              } catch {}
            }
            NodeFS.rmSync(DEV_SERVER_PIDFILE, { force: true });
          }),
        ),
      );
    },
  );

  it.live("Show on dev pressed by you asks and allows at once, as you", () => {
    const started: Array<number> = [];
    return withCrewEngine((world) =>
      Effect.gen(function* () {
        write(
          world.root,
          "zerops.yaml",
          "zerops:\n  - setup: appdev\n    run:\n      ports:\n        - port: 3000\n          httpSupport: true\n",
        );
        git(world.root, ["add", "-A"]);
        git(world.root, ["commit", "-q", "-m", "zerops.yaml"]);
        yield* applied(world);
        started.push(startDevServer(world.root));
        yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
        const [created] = yield* dispatchedOf(world, "thread.crew.create");
        yield* world.publish(spiEvent("turn.completed", created!.threadId, { state: "completed" }));
        yield* eventually(
          command({ _tag: "showOnDev", handle: "backend" }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        );
        const starting = yield* snapshotWhere(
          (snapshot) => snapshot.hosts[0]?.claim.state === "starting",
        );
        assert.deepStrictEqual(
          [
            starting.hosts[0]!.claim.handle,
            (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.message.text.split("\n")[1],
            (yield* Ref.get(world.admitted)).at(-1)?.principal,
          ],
          ["backend", "Show your work on appdev", KAREL],
        );
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const pid of started) {
            try {
              process.kill(pid);
            } catch {}
          }
          NodeFS.rmSync(DEV_SERVER_PIDFILE, { force: true });
        }),
      ),
    );
  });

  it.live(
    "the crew's thread policy: installed at Apply, a profile for the live stint, deny-all once retired, none for a person",
    () =>
      withCrewEngine(
        (world) =>
          Effect.gen(function* () {
            const registry = yield* ThreadToolPolicyRegistry;
            const before = yield* registry.current;
            yield* applied(world);
            const thread = yield* firstTurn(world, () => undefined);
            yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
            const policy = Option.getOrThrow(yield* registry.current);
            const profileOf = (threadId: string) =>
              policy.profileFor({
                threadId: ThreadIdSchema.make(threadId),
                instanceId: ProviderInstanceId.make("claudeAgent"),
              });
            const live = yield* profileOf(thread);
            const person = yield* profileOf("person-thread");
            yield* eventually(
              command({ _tag: "startFresh", handle: "backend" }).pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              ),
            );
            const retired = yield* profileOf(thread);
            assert.deepStrictEqual(
              {
                before: Option.isNone(before),
                live: [
                  live?.sessionContext.includes("You are @backend"),
                  live?.sessionContext.includes("# Brief v1: Space shooter"),
                  live?.readOnly,
                  live?.tools.map((tool) => tool.name),
                ],
                person,
                retired: [retired?.readOnly, retired?.tools.length],
              },
              {
                before: true,
                live: [
                  true,
                  true,
                  false,
                  ["crew_report", "crew_board", "crew_diff", "crew_show_on_dev"],
                ],
                person: undefined,
                retired: [true, 0],
              },
            );
          }),
        { installer: () => installCrewThreadPolicy },
      ),
  );

  it.live(
    "Apply refuses a lead on a Codex login, naming why; a Codex writer runs without crew tools",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* Ref.set(
            world.logins,
            new Map([["codex_work", mateLogin("codex_work", "codex", "work")]]),
          );
          const crewYaml = (leadLogin: string) =>
            [
              "name: Game team",
              "briefTitle: Space shooter",
              "members:",
              "  - handle: lead",
              "    displayName: Lead",
              "    kind: lead",
              `    login: ${leadLogin}`,
              "  - handle: backend",
              "    displayName: Backend",
              "    host: appdev",
              "    login: codex_work",
              "",
            ].join("\n");
          writeCrewHome(world.workspace, {
            "crew.yaml": crewYaml("codex_work"),
            "jobs/lead.md": "Plan the work.\n",
          });
          const refused = yield* Effect.flip(command({ _tag: "apply" }));
          writeCrewHome(world.workspace, {
            "crew.yaml": crewYaml("claudeAgent"),
            "jobs/lead.md": "Plan the work.\n",
          });
          yield* command({ _tag: "apply" });
          yield* eventually(Effect.map(latest, everyCopyReady));
          yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
          const created = (yield* dispatchedOf(world, "thread.crew.create")).find(
            (entry) => entry.crew.crewmate === "backend",
          )!;
          const member = Option.getOrThrow(
            yield* (yield* CrewThreadDirectory).memberFor(created.threadId),
          );
          assert.deepStrictEqual(
            [
              refused.reason,
              refused.detail?.includes("Codex cannot host"),
              member.prompt.crewTools,
            ],
            ["invalid-definition", true, false],
          );
        }),
      ),
  );

  it.live("before any crew exists the crew home reads as an empty set, never a refusal", () =>
    withCrewEngine(() =>
      Effect.gen(function* () {
        const engine = yield* CrewEngine;
        assert.deepStrictEqual(
          [yield* engine.readFiles, (yield* latest).status],
          [{ files: [] }, "none"],
        );
      }),
    ),
  );

  it.live(
    "the dev services this Mate mounts show before any crew; opening the crew home reads their databases",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          const engine = yield* CrewEngine;
          const before = yield* snapshotWhere((current) => current.devHosts.length > 0);
          const sshBefore = yield* Ref.get(world.sshCalls);
          yield* engine.readFiles;
          const read = yield* snapshotWhere((current) => current.devHosts[0]?.database !== null);
          assert.deepStrictEqual(
            [
              before.status,
              before.devHosts,
              sshBefore,
              read.devHosts.map((host) => [host.host, typeof host.database]),
            ],
            ["none", [{ host: TEST_HOST, database: null }], 0, [[TEST_HOST, "boolean"]]],
          );
        }),
      ),
  );

  it.live(
    "a writer's conversation runs in its copy; your tree's branch and head are in the snapshot",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({ _tag: "message", handle: "backend", text: "Start", attachments: [] });
          const [created] = yield* dispatchedOf(world, "thread.crew.create");
          const snapshot = yield* snapshotWhere(
            (current) => current.hosts[0]?.integration !== null,
          );
          assert.deepStrictEqual(
            [created!.worktreePath, snapshot.hosts[0]!.integration],
            [
              `${world.root}/.crew/backend`,
              { branch: "main", head: git(world.root, ["rev-parse", "HEAD"]) },
            ],
          );
        }),
      ),
  );

  it.live("Try again on a stopped task queues it for its next attempt and starts it", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/.env", "SECRET=1\n"),
        );
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        // The guard left the file uncommitted: the copy reads dirty with nothing ahead.
        const parked = yield* snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "parked" &&
            current.crewmates[0]!.lane?.dirty === true,
        );
        NodeFS.rmSync(NodePath.join(world.root, ".crew/backend/.env"));
        yield* command({ _tag: "taskRetry", taskId: parked.board.tasks[0]!.id });
        const retried = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "working",
        );
        assert.deepStrictEqual(
          [parked.board.tasks[0]!.reason?.includes(".env"), retried.board.tasks[0]!.attempts],
          [true, 2],
        );
      }),
    ),
  );
});
