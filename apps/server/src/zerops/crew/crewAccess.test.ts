/**
 * D6 at the crew's door: a press that runs or changes the crew is judged, as
 * the person, on every login it reaches, and refused before anything moves;
 * a write to the crew home on the logins of what it changes.
 */
import { assert, describe, it } from "@effect/vitest";
import type { CrewCommand } from "@t3tools/contracts";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "@t3tools/shared/crewHome";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { MateLogin } from "../ZeropsLogins.ts";
import { crewHomeChange, type CrewHomeChange } from "./crewAccess.ts";
import { CrewEngine } from "./CrewEngine.ts";
import { withCrewEngine, writeCrewHome, type CrewWorld } from "./testing/crewEngineFixture.ts";
import {
  KAREL,
  command,
  dispatchedOf,
  everyCopyReady,
  firstTurn,
  latest,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { read } from "./testing/crewGitFixture.ts";

const member = (handle: string, fields: Partial<CrewMemberSpec> = {}): CrewMemberSpec => ({
  handle,
  displayName: handle,
  kind: "reader",
  readOnly: true,
  restartAfterMerge: false,
  afterLandRestart: false,
  env: {},
  migrations: [],
  job: `${handle}'s job.\n`,
  ...fields,
});

const home = (
  members: ReadonlyArray<CrewMemberSpec>,
  brief = "Ship the space shooter.\n",
): CrewDefinition => ({
  crew: "main",
  name: "Game team",
  brief: parseBrief("Space shooter", brief),
  members,
});

const LEAD = member("lead", { kind: "lead" });
const BACKEND = member("backend", { kind: "writer", readOnly: false, host: "appdev" });

describe("crewHomeChange", () => {
  it.each([
    ["a first home is all new", undefined, home([LEAD]), { shared: true, handles: [] }],
    [
      "the same home changes nothing",
      home([LEAD, BACKEND]),
      home([LEAD, BACKEND]),
      { shared: false, handles: [] },
    ],
    [
      "a job changes its crewmate",
      home([LEAD, BACKEND]),
      home([LEAD, { ...BACKEND, job: "Own the API.\n" }]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "a login changes its crewmate",
      home([LEAD, BACKEND]),
      home([LEAD, { ...BACKEND, login: "claudeAgent_eva" }]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "a crewmate added",
      home([LEAD]),
      home([LEAD, BACKEND]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "a crewmate removed",
      home([LEAD, BACKEND]),
      home([LEAD]),
      { shared: false, handles: ["backend"] },
    ],
    [
      "the goal changes what every crewmate shares",
      home([LEAD, BACKEND]),
      home([LEAD, BACKEND], "Ship the sequel.\n"),
      { shared: true, handles: [] },
    ],
  ] as const satisfies ReadonlyArray<
    readonly [string, CrewDefinition | undefined, CrewDefinition, CrewHomeChange]
  >)("%s", (_name, before, after, change) => {
    assert.deepStrictEqual(crewHomeChange(before, after), change);
  });
});

const EVA_LOGIN: MateLogin = {
  id: "claudeAgent_eva",
  agent: "claude-code",
  kind: "subscription",
  label: "eva",
  home: "/home/zerops/.mate/logins/claudeAgent_eva",
  keyStored: false,
};

const EVAS = "Claude Code · eva was signed in by another project member — only they can run it.";
const THEIRS = "This agent was signed in by another project member — only they can run it.";

/** The lead on the Mate's default login; Backend on Eva's second Claude login. */
const CREW_YAML = [
  "name: Game team",
  "briefTitle: Space shooter",
  "members:",
  "  - handle: lead",
  "    displayName: Lead",
  "    kind: lead",
  "  - handle: backend",
  "    displayName: Backend",
  "    host: appdev",
  "    login: claudeAgent_eva",
  "    check: test -f ok.txt",
  "",
].join("\n");

/** What a press met at the door: refused in admission's words, or let past, and the logins judged. */
const atTheDoor = (world: CrewWorld, press: CrewCommand) =>
  Effect.gen(function* () {
    const before = (yield* Ref.get(world.operated)).length;
    const outcome = yield* command(press).pipe(
      Effect.match({
        onFailure: (error) =>
          error.reason === "not-allowed" ? `refused: ${error.detail ?? ""}` : "let past",
        onSuccess: () => "let past",
      }),
    );
    const judged = (yield* Ref.get(world.operated)).slice(before).map((entry) => entry.instanceIds);
    return [outcome, judged] as const;
  });

describe("the crew's door", () => {
  it.live("judges each press on the logins it reaches, and refuses the ones Eva's login runs", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* Ref.set(world.logins, new Map([[EVA_LOGIN.id, EVA_LOGIN]]));
        writeCrewHome(world.workspace, {
          "crew.yaml": CREW_YAML,
          "jobs/lead.md": "Plan the work.\n",
        });
        yield* command({ _tag: "apply" });
        yield* snapshotWhere(everyCopyReady);
        yield* command({
          _tag: "taskCreate",
          owner: "backend",
          title: "Paginate",
          brief: "Cursor based.",
          doneWhen: "",
          dependsOn: [],
        });
        const taskId = (yield* snapshotWhere((current) => current.board.tasks.length > 0)).board
          .tasks[0]!.id;
        // Karel may run the Mate's default login, and not Eva's.
        yield* Ref.set(world.notTheirs, new Map([[EVA_LOGIN.id, EVAS]]));
        const tasksBefore = (yield* latest).board.tasks.length;

        const refused = `refused: ${EVAS}`;
        const rows: ReadonlyArray<
          readonly [CrewCommand, string, ReadonlyArray<ReadonlyArray<string>>]
        > = [
          [
            { _tag: "message", handle: "backend", text: "More", attachments: [] },
            refused,
            [["claudeAgent_eva"]],
          ],
          [
            {
              _tag: "taskCreate",
              owner: "backend",
              title: "Queue it",
              brief: "",
              doneWhen: "",
              dependsOn: [],
            },
            refused,
            [["claudeAgent_eva"]],
          ],
          [{ _tag: "discard", taskId }, refused, [["claudeAgent_eva"]]],
          [{ _tag: "taskEdit", taskId, title: "Renamed" }, refused, [["claudeAgent_eva"]]],
          [{ _tag: "land", taskId }, refused, [["claudeAgent_eva"]]],
          [{ _tag: "startFresh", handle: "backend" }, refused, [["claudeAgent_eva"]]],
          [
            { _tag: "removeCrewmate", handle: "backend", discardUnlanded: true },
            refused,
            [["claudeAgent_eva"]],
          ],
          [{ _tag: "appRun", handle: "backend" }, refused, [["claudeAgent_eva"]]],
          [
            { _tag: "jobSave", handle: "backend", apply: "nextTurn" },
            refused,
            [["claudeAgent_eva"]],
          ],
          [
            {
              _tag: "start",
              budgetUsd: 5,
              timeLimitHours: 1,
              stopAtUsagePercent: null,
              landing: "person",
              devGrant: false,
              leadMayStart: false,
            },
            refused,
            [["claudeAgent", "claudeAgent_eva"]],
          ],
          [{ _tag: "resume", runId: "run-gone" }, refused, [["claudeAgent", "claudeAgent_eva"]]],
          [{ _tag: "finish", runId: "run-gone" }, refused, [["claudeAgent", "claudeAgent_eva"]]],
          [{ _tag: "briefSave", apply: "nextTurn" }, refused, [["claudeAgent", "claudeAgent_eva"]]],
          [{ _tag: "apply" }, refused, [["claudeAgent", "claudeAgent_eva"]]],
          // Any member stops or pauses a crew (D6): neither reaches a login.
          [{ _tag: "stop", runId: "run-gone" }, "let past", []],
          [{ _tag: "pause", runId: "run-gone" }, "let past", []],
          // The lead's own login is Karel's: telling the crew goes to the lead.
          [
            { _tag: "tell", text: "Plan the pagination", mentions: [] },
            "let past",
            [["claudeAgent"]],
          ],
          [{ _tag: "startFresh", handle: "lead" }, "let past", [["claudeAgent"]]],
          [{ _tag: "deliverDraft" }, "let past", []],
          [{ _tag: "orphanScan" }, "let past", []],
        ];
        const seen: Array<readonly [string, ReadonlyArray<ReadonlyArray<string>>]> = [];
        for (const [press] of rows) {
          seen.push(yield* atTheDoor(world, press));
        }
        assert.deepStrictEqual(
          seen,
          rows.map(([, outcome, judged]) => [outcome, judged] as const),
        );
        const after = yield* latest;
        assert.deepStrictEqual(
          {
            tasks: after.board.tasks.length,
            run: after.run,
            backend: after.crewmates.some((mate) => mate.handle === "backend"),
            judgedAs: (yield* Ref.get(world.operated)).every((entry) => entry.principal === KAREL),
          },
          { tasks: tasksBefore, run: null, backend: true, judgedAs: true },
        );
      }),
    ),
  );

  it.live(
    "lets a colleague who may run no login pause and stop a running crew, its turns interrupted, and nothing more",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* Ref.set(world.logins, new Map([[EVA_LOGIN.id, EVA_LOGIN]]));
          writeCrewHome(world.workspace, {
            "crew.yaml": CREW_YAML,
            "jobs/lead.md": "Plan the work.\n",
          });
          yield* command({ _tag: "apply" });
          yield* snapshotWhere(everyCopyReady);
          yield* command({
            _tag: "start",
            budgetUsd: 5,
            timeLimitHours: 1,
            stopAtUsagePercent: null,
            landing: "person",
            devGrant: false,
            leadMayStart: false,
          });
          const runId = (yield* snapshotWhere((current) => current.run?.state === "running")).run!
            .id;
          const thread = yield* firstTurn(world, () => undefined);
          // From here Karel stands for a colleague who may run neither login.
          yield* Ref.set(
            world.notTheirs,
            new Map([
              ["claudeAgent", THEIRS],
              [EVA_LOGIN.id, EVAS],
            ]),
          );
          const admittedBefore = (yield* Ref.get(world.admitted)).length;
          yield* command({ _tag: "pause", runId });
          const paused = (yield* snapshotWhere((current) => current.run?.state === "paused")).run!;
          const resumed = yield* Effect.flip(command({ _tag: "resume", runId }));
          const finished = yield* Effect.flip(command({ _tag: "finish", runId }));
          yield* command({ _tag: "stop", runId });
          const stopped = (yield* snapshotWhere((current) => current.run?.state === "stopped"))
            .run!;
          const interrupted = (yield* dispatchedOf(world, "thread.turn.interrupt")).filter(
            (entry) => entry.threadId === thread,
          );
          assert.deepStrictEqual(
            {
              paused: [paused.reason, paused.startedBy],
              resumed: [resumed.reason, resumed.detail],
              finished: finished.reason,
              stopped: stopped.state,
              // One interrupt for the pause, and one for the stop.
              interrupted: interrupted.length,
              // The crew's interrupts ask admission nothing: a turn's interrupt is every member's.
              admitted: (yield* Ref.get(world.admitted)).slice(admittedBefore),
            },
            {
              paused: ["person", "user-karel"],
              resumed: ["not-allowed", THEIRS],
              finished: "not-allowed",
              stopped: "stopped",
              interrupted: 2,
              admitted: [],
            },
          );
        }),
      ),
  );

  it.live("judges a write to the crew home on the logins of what it changes", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* Ref.set(world.logins, new Map([[EVA_LOGIN.id, EVA_LOGIN]]));
        writeCrewHome(world.workspace, {
          "crew.yaml": CREW_YAML,
          "jobs/lead.md": "Plan the work.\n",
        });
        yield* command({ _tag: "apply" });
        yield* snapshotWhere(everyCopyReady);
        yield* Ref.set(world.notTheirs, new Map([[EVA_LOGIN.id, EVAS]]));
        const engine = yield* CrewEngine;
        const write = (path: string, content: string) =>
          Effect.gen(function* () {
            const before = (yield* Ref.get(world.operated)).length;
            const outcome = yield* engine.writeFiles({ files: [{ path, content }] }, KAREL).pipe(
              Effect.match({
                onFailure: (error) => `${error.reason}: ${error.detail ?? ""}`,
                onSuccess: () => "written",
              }),
            );
            const judged = (yield* Ref.get(world.operated)).slice(before);
            return [outcome, judged.map((entry) => entry.instanceIds)] as const;
          });
        const rows = [
          yield* write("jobs/lead.md", "Plan the work, then review it.\n"),
          yield* write("jobs/backend.md", "Own the API.\n"),
          yield* write("brief.md", "Ship the sequel.\n"),
        ];
        assert.deepStrictEqual(rows, [
          ["written", [["claudeAgent"]]],
          [`not-allowed: ${EVAS}`, [["claudeAgent_eva"]]],
          [`not-allowed: ${EVAS}`, [["claudeAgent", "claudeAgent_eva"]]],
        ]);
        assert.deepStrictEqual(
          [
            read(world.workspace, ".mate/crew/main/jobs/lead.md"),
            read(world.workspace, ".mate/crew/main/jobs/backend.md"),
            read(world.workspace, ".mate/crew/main/brief.md"),
          ],
          [
            "Plan the work, then review it.\n",
            "You own the server.\n",
            "Ship the space shooter.\n",
          ],
        );
      }),
    ),
  );
});
