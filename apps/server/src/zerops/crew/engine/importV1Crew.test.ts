/**
 * A Mate with a crew keeps its crew when it flips to the engine: V1's crew tables, written through
 * V1's own repositories (`testing/v1CrewSeed.ts`), read once and taken by the crew owner; each
 * crewmate's stints brought into its one conversation by the engine's history import.
 */
import { afterAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CREW_OWNER_ID,
  ConversationId,
  type CrewCommand,
  type Principal,
} from "@t3tools/contracts";

import { Conversations, type ConversationsShape } from "../../../engine/Conversations.ts";
import { askImport, makeHistoryImport } from "../../../engine/effects/historyImport.ts";
import { ok } from "../../../engine/effects/shared.ts";
import {
  EffectHandlers,
  handlersOf,
  makeEffectWorker,
  type EffectHandler,
} from "../../../engine/outbox/EffectWorker.ts";
import { EngineStoreError, type CommitStage } from "../../../engine/store/EngineStore.ts";
import { engineLayer, newBoot, tempDb, type Engine } from "../../../engine/testing/world.ts";
import { itemOfRow } from "../../../engine/wire/records.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { DEFINITION, FLIP, LANDED, at, seedV1Crew, v1CrewTables } from "../testing/v1CrewSeed.ts";
import type { CrewEnvelope } from "./command.ts";
import { crewDomain } from "./CrewOwner.ts";
import { CrewWorld } from "./crewDecideFixture.ts";
import { IMPORTED_ROW, QUESTION_TO_PERSON_MS } from "./decide.ts";
import {
  FINISHED_PER_CREWMATE,
  UPDATE_PAUSE,
  crewImportOf,
  importV1Crew,
  readV1Crew,
  type V1Crew,
} from "./importV1Crew.ts";
import { EMPTY_VIEW, crewSnapshotOf } from "./project.ts";

const ENGINE: Principal = { kind: "engine" };
const ana = ConversationId.make("crew-main-ana-1");
const bob = ConversationId.make("crew-main-bob-1");

// ── V1's crew, read once ────────────────────────────────────────────────────────────────────

/** V1's crew as the flip reads it, read once for the rows that only read it. */
let held: V1Crew | undefined;
const readOnce = Effect.suspend(() => {
  if (held !== undefined) return Effect.succeed(held);
  const file = tempDb("v1-crew");
  return Effect.gen(function* () {
    yield* seedV1Crew(file);
    const read = yield* readV1Crew.pipe(Effect.provide(NodeSqliteClient.layer({ filename: file })));
    if (read === null) return yield* Effect.die("the seeded crew reads as none");
    held = read;
    return read;
  });
});

/** The crew owner after the flip's import, at the flip. */
const flipped = (from: V1Crew) => {
  const world = new CrewWorld();
  world.now = FLIP;
  world.tell({ _tag: "ImportV1", crew: crewImportOf(from, FLIP).crew }, ENGINE);
  return world;
};

const snapshotOf = (world: CrewWorld) =>
  crewSnapshotOf(world.state, { ...EMPTY_VIEW, nowMs: world.now });

const press = (world: CrewWorld, command: CrewCommand) => {
  const decision = world.press(command);
  if (decision._tag === "Reject") throw new Error(decision.rejection.detail ?? "rejected");
  return world;
};

/** Every crewmate's copy read again by the boot's sweep. */
const swept = (world: CrewWorld) => world.settleAll("crew.sweep", () => true, { swept: true });

const sendsTo = (world: CrewWorld, handle: string) =>
  world.delivered.filter(
    (delivery) => delivery.handle === handle && delivery.command._tag === "Send",
  );

describe("a flip imports a crew's open work waiting on you, its finished work bounded, its running run paused", () => {
  const rows: ReadonlyArray<readonly [string, (v1: V1Crew) => void]> = [
    [
      "its run, working on its own, stopped for the update; Keep going carries its work on",
      (v1) => {
        const world = flipped(v1);
        expect(snapshotOf(world).run).toMatchObject({
          id: "run-1",
          state: "paused",
          reason: null,
          reasonDetail: UPDATE_PAUSE,
          spentUsd: 1.5,
        });
        expect(sendsTo(swept(world), "ana")).toEqual([]);
        press(world, { _tag: "resume", runId: "run-1" });
        expect(world.state.run?.state).toBe("running");
        expect(sendsTo(world, "ana").map((send) => send.command)).toMatchObject([
          { _tag: "Send", card: { kind: "continue", taskId: "task-1" } },
        ]);
      },
    ],
    [
      "a task mid-check waits on you; Continue merges it again",
      (v1) => {
        const world = swept(flipped(v1));
        const row = snapshotOf(world).attention.find(
          (entry) => entry.id === `${IMPORTED_ROW}task-2`,
        );
        expect(row).toMatchObject({ id: `${IMPORTED_ROW}task-2`, kind: "interrupted" });
        expect(world.state.tasks["task-2"]?.state).toBe("merging");
        expect(world.pending("crew.mergeIn", "bob")).toBeUndefined();
        press(world, { _tag: "operationContinue", handle: "bob", operationId: row!.id });
        expect(world.pending("crew.mergeIn", "bob")).toBeDefined();
      },
    ],
    [
      "a task mid-landing waits on you; Continue lands it",
      (v1) => {
        const world = swept(flipped(v1));
        const row = snapshotOf(world).attention.find(
          (entry) => entry.id === `${IMPORTED_ROW}task-3`,
        );
        expect(row).toMatchObject({ id: `${IMPORTED_ROW}task-3`, kind: "interrupted" });
        expect(world.state.tasks["task-3"]).toMatchObject({
          state: "ready",
          counters: { attempt: 2, reworks: 1 },
          check: { state: "passed", tip: "abc123" },
        });
        expect(world.pending("crew.land", "cy")).toBeUndefined();
        press(world, { _tag: "operationContinue", handle: "cy", operationId: row!.id });
        expect(world.pending("crew.land", "cy")?.payload).toMatchObject({
          taskId: "task-3",
          checkedTip: "abc123",
        });
      },
    ],
    [
      "a task outside a run, mid-way, waits on you; Continue carries it on",
      (v1) => {
        const world = swept(flipped({ ...v1, run: null }));
        const row = snapshotOf(world).attention.find(
          (entry) => entry.id === `${IMPORTED_ROW}task-1`,
        );
        expect(row).toMatchObject({ id: `${IMPORTED_ROW}task-1`, kind: "interrupted" });
        world.quiet();
        press(world, { _tag: "operationContinue", handle: "ana", operationId: row!.id });
        expect(sendsTo(world, "ana").map((send) => send.command)).toMatchObject([
          { _tag: "Send", card: { kind: "continue", taskId: "task-1" } },
        ]);
      },
    ],
    [
      "a crewmate's question waits on its asker, and on you from when it was asked",
      (v1) => {
        const world = flipped(v1);
        expect(world.state.tasks["task-5"]).toMatchObject({
          state: "blocked",
          askedAt: Date.parse(at(30)),
          report: { question: "Which port?" },
        });
        expect(Object.values(world.state.wakes)).toContainEqual(
          expect.objectContaining({
            kind: "question",
            dueAt: Date.parse(at(30)) + QUESTION_TO_PERSON_MS,
          }),
        );
      },
    ],
    [
      "each crewmate's newest finished work comes over; older work stays with V1",
      (v1) => {
        const world = flipped(v1);
        const landed = Object.values(world.state.tasks)
          .filter((task) => task.owner === "ana" && task.state === "landed")
          .map((task) => task.number)
          .toSorted((left, right) => left - right);
        expect(landed).toHaveLength(FINISHED_PER_CREWMATE);
        expect(landed[0]).toBe(100 + LANDED - FINISHED_PER_CREWMATE);
        expect(world.state.tasks["task-200"]?.state).toBe("discarded");
        expect(world.state.nextTaskNumber).toBe(201);
      },
    ],
    [
      "queued work keeps its place behind what it depends on",
      (v1) => {
        const world = swept(flipped(v1));
        expect(world.state.tasks["task-4"]).toMatchObject({
          state: "queued",
          dependsOn: ["task-1"],
          started: false,
        });
      },
    ],
    [
      "a held claim stays, its dev server read again; a request is dropped",
      (v1) => {
        const world = flipped(v1);
        expect(Object.keys(world.state.claims)).toEqual(["appdev"]);
        expect(world.pending("crew.claim.read", "appdev")?.payload).toMatchObject({
          purpose: "import",
          handle: "ana",
        });
        world.settle("crew.claim.read", "appdev", {
          served: { by: "crewmate", handle: "ana" },
          devServer: { port: 3000, command: "npm run dev" },
          workDir: ".crew/ana",
        });
        expect(world.state.claims["appdev"]).toMatchObject({
          state: "held",
          devServer: { port: 3000, command: "npm run dev" },
          workDir: ".crew/ana",
        });
      },
    ],
    [
      "a held claim its dev server no longer serves is let go",
      (v1) => {
        const world = flipped(v1);
        world.settle("crew.claim.read", "appdev", {
          served: { by: "tree" },
          devServer: { port: 3000, command: "npm run dev" },
          workDir: ".crew/ana",
        });
        expect(world.state.claims["appdev"]).toBeUndefined();
      },
    ],
    [
      "each crewmate keeps its login, model, effort, port and copy, in its one conversation",
      (v1) => {
        const world = flipped(v1);
        expect(world.state.order).toEqual(["lead", "ana", "bob", "cy", "dee"]);
        expect(world.state.members["ana"]).toMatchObject({
          conversationId: ana,
          login: "claudeAgent",
          model: "claude-opus-4-5",
          effort: "high",
          crewPort: 4001,
          jobVersion: 3,
          tint: "violet",
          lane: { state: "ready" },
          session: { count: 3, lastReason: "job", compactions: 2 },
        });
        expect(world.state.members["bob"]).toMatchObject({
          conversationId: bob,
          login: "codex",
          lane: { state: "missing" },
        });
        expect(world.state.hosts["appdev"]?.crewPorts).toEqual([{ port: 4001, routed: true }]);
        expect(snapshotOf(world).crewmates.map((mate) => mate.conversationId)).toEqual([
          "crew-main-lead-1",
          ana,
          bob,
          "crew-main-cy-1",
          "crew-main-dee-1",
        ]);
        expect(world.delivered.map((delivery) => delivery.command)).toContainEqual({
          _tag: "AssignAgent",
          instanceId: "codex",
          model: null,
          effort: null,
          profile: { kind: "crewmate", id: "bob", name: "Bob" },
        });
      },
    ],
    [
      "a crewmate's memory comes over whole",
      (v1) => {
        const world = flipped(v1);
        const decision = flipped(v1).last;
        expect(world.state.applied?.briefVersion).toBe(2);
        const changes =
          decision?._tag === "Accept"
            ? decision.step.events.filter((event) => event._tag === "MemoryChanged")
            : [];
        expect(changes).toMatchObject([
          {
            handle: "ana",
            op: {
              op: "imported",
              entries: [{ id: "mem-1", kind: "lesson", text: "Run the build before the check." }],
            },
          },
        ]);
      },
    ],
    [
      "nothing of the crew's own goes out in the import: agents, the claim's read and the sweep",
      (v1) => {
        const world = flipped(v1);
        const decision = world.last;
        const kinds =
          decision?._tag === "Accept"
            ? decision.step.effects.map((effect) =>
                effect.payload.kind === "crew.deliver"
                  ? `deliver ${effect.payload.command._tag}`
                  : effect.kind,
              )
            : [];
        expect(kinds.toSorted()).toEqual(
          [
            ...DEFINITION.members.map(() => "deliver AssignAgent"),
            "crew.claim.read",
            "crew.sweep",
            "crew.sweep",
          ].toSorted(),
        );
      },
    ],
    [
      "a crewmate with work open starts its first session from its state packet",
      (v1) => {
        const world = swept(flipped(v1));
        expect(world.delivered.map((delivery) => delivery.command)).toContainEqual(
          expect.objectContaining({
            _tag: "RotateSession",
            reason: "context",
            fresh: true,
            packet: { handle: "ana", taskId: "task-1" },
          }),
        );
      },
    ],
  ];
  it.effect.each(rows)("%s", ([, check]) => Effect.map(readOnce, check));
});

describe("a re-run imports nothing", () => {
  it.effect("the crew owner takes a second import as nothing", () =>
    Effect.map(readOnce, (v1) => {
      const world = flipped(v1);
      const before = world.state;
      const again = world.tell(
        { _tag: "ImportV1", crew: crewImportOf(v1, FLIP + 1000).crew },
        ENGINE,
      );
      expect(again).toMatchObject({ _tag: "Accept", step: { events: [], effects: [] } });
      expect(world.state).toBe(before);
    }),
  );
});

// ── on the engine ───────────────────────────────────────────────────────────────────────────

/** The crew as an owner of the engine: crew's own rules, its events stored as they are. */
/** The crew's effects as their handlers would answer: each lands and reads as it stood. */
const crewHandlers: ReadonlyArray<EffectHandler> = [
  { kind: "crew.deliver", run: () => Effect.succeed(ok({})) },
  { kind: "crew.sweep", run: () => Effect.succeed(ok({ swept: true })) },
  {
    kind: "crew.claim.read",
    run: () =>
      Effect.succeed(
        ok({
          served: { by: "crewmate", handle: "ana" },
          devServer: { port: 3000, command: "npm run dev" },
          workDir: ".crew/ana",
        }),
      ),
  },
];

type Worker = Effect.Success<ReturnType<typeof makeEffectWorker>>;

interface Lifetime {
  readonly fault?: (stage: CommitStage) => Effect.Effect<void, EngineStoreError>;
  readonly tell?: (tell: ConversationsShape["tell"]) => ConversationsShape["tell"];
}

/** The flip as the wiring binds it: each chain through `askImport`, the crew through its door. */
const flipOn = (conversations: ConversationsShape, sql: SqlClient.SqlClient) => {
  const crew = conversations.owner(crewDomain);
  return importV1Crew(
    {
      history: (conversation, source) =>
        askImport(conversation, source).pipe(
          Effect.provideService(Conversations, conversations),
          Effect.provideService(SqlClient.SqlClient, sql),
        ),
      crew: (envelope: CrewEnvelope) =>
        crew.tell({
          commandId: envelope.commandId,
          conversationId: CREW_OWNER_ID,
          principal: envelope.principal,
          command: envelope.input,
        }),
    },
    FLIP,
  ).pipe(Effect.provideService(SqlClient.SqlClient, sql));
};

/** One process lifetime on the file: the engine with the crew, its worker and the import's. */
const lifetime = <A, E>(
  file: string,
  body: (tools: {
    readonly worker: Worker;
    readonly flip: ReturnType<typeof flipOn>;
  }) => Effect.Effect<A, E, Engine | SqlClient.SqlClient>,
  options: Lifetime = {},
) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const sql = yield* SqlClient.SqlClient;
    const door =
      options.tell === undefined
        ? conversations
        : { ...conversations, tell: options.tell(conversations.tell) };
    const history = yield* makeHistoryImport({ records: 3 }).pipe(
      Effect.provideService(Conversations, door),
    );
    const worker = yield* makeEffectWorker(newBoot()).pipe(
      Effect.provideService(EffectHandlers, handlersOf(history, ...crewHandlers)),
      Effect.provideService(Conversations, door),
    );
    yield* worker.reconcileAtBoot();
    return yield* body({ worker, flip: flipOn(door, sql) });
  }).pipe(
    Effect.provide(
      engineLayer(file, new Map(), options.fault === undefined ? {} : { fault: options.fault }, [
        crewDomain,
      ]),
    ),
  );

/** Works the outbox until nothing waits in it. */
const drain = (worker: Worker) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (let round = 0; round < 400; round++) {
      if (yield* worker.runOnce) continue;
      const [waiting] = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM engine_effect WHERE state IN ('pending', 'running', 'settling')
      `;
      if ((waiting?.n ?? 0) === 0) return;
      yield* Effect.sleep(20);
    }
  });

const parse = (text: string): unknown => JSON.parse(text);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** What the flip left: the crew owner's state and each crewmate's record as its readers get it. */
const heldAfter = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const conversations = yield* Conversations;
  const crew = yield* conversations.owner(crewDomain).state(CREW_OWNER_ID);
  const records: Record<string, unknown> = {};
  for (const conversation of [ana, bob]) {
    const runs = yield* sql<{ readonly run_id: string; readonly trigger_json: string }>`
      SELECT run_id, trigger_json FROM engine_run WHERE conversation_id = ${conversation}
      ORDER BY ordinal
    `;
    const items = yield* Effect.forEach(
      yield* sql<Parameters<typeof itemOfRow>[0]>`
        SELECT * FROM engine_item WHERE conversation_id = ${conversation} ORDER BY opened_seq
      `,
      itemOfRow,
    );
    const history = (yield* conversations.state(conversation)).history;
    records[conversation] = {
      runs: runs.map((run) => [run.run_id, parse(run.trigger_json)]),
      items: items.map(({ seq: _seq, rev: _rev, ...item }) => item),
      history: history?.state ?? null,
    };
  }
  // The crew's record holds one import: its apply, its tasks and its memory, once.
  const imported = yield* sql<{ readonly type: string; readonly n: number }>`
    SELECT type, COUNT(*) AS n FROM engine_event
    WHERE conversation_id = ${CREW_OWNER_ID}
      AND type IN ('CrewApplied', 'TaskCreated', 'MemoryChanged', 'AttentionRaised', 'RunStarted')
    GROUP BY type ORDER BY type
  `;
  return {
    imported: imported.map((row) => [row.type, row.n]),
    crew: {
      ...crew,
      // How many steps and effects it took, and when, is the clock's and the boots' (each boot
      // sweeps the copies again): what the crew holds is the import's.
      headSeq: 0,
      effectSeq: 0,
      members: Object.fromEntries(
        Object.entries(crew.members).map(([handle, member]) => [
          handle,
          { ...member, session: { ...member.session, startedAt: 0 } },
        ]),
      ),
      effects: Object.values(crew.effects).length,
      deliveries: Object.values(crew.deliveries).length,
    },
    records,
  };
});

const seeded = (label: string) =>
  Effect.gen(function* () {
    const file = tempDb(label);
    yield* seedV1Crew(file);
    return file;
  });

const flippedOnce = Effect.gen(function* () {
  const file = yield* seeded("crew-flip");
  return yield* lifetime(file, ({ worker, flip }) =>
    Effect.gen(function* () {
      yield* flip;
      yield* drain(worker);
      return yield* heldAfter;
    }),
  );
});

let reference: Effect.Success<typeof flippedOnce> | undefined;
const cached = Effect.suspend(() =>
  reference === undefined
    ? flippedOnce.pipe(Effect.tap((held) => Effect.sync(() => (reference = held))))
    : Effect.succeed(reference),
);
afterAll(() => {
  reference = undefined;
});

describe("the flip on the engine", () => {
  it.live("a crewmate's stints read as one conversation with boundaries", () =>
    Effect.gen(function* () {
      const held = yield* cached;
      const record = held.records[ana] as {
        readonly runs: ReadonlyArray<readonly [string, { readonly turn: string }]>;
        readonly items: ReadonlyArray<{ readonly kind: string; readonly marker?: unknown }>;
        readonly history: string;
      };
      expect(record.history).toBe("complete");
      expect(record.runs.map(([, trigger]) => trigger.turn)).toEqual([
        "ana-s1-turn-0",
        "ana-s1-turn-1",
        "ana-s2-turn-0",
        "ana-s2-turn-1",
        "ana-s3-turn-0",
        "ana-s3-turn-1",
      ]);
      expect(record.items.flatMap((item) => (item.kind === "marker" ? [item.marker] : []))).toEqual(
        [
          { kind: "session-rotated", reason: "cleared" },
          { kind: "session-rotated", reason: "job" },
        ],
      );
      expect(record.items.filter((item) => item.kind === "person")).toHaveLength(6);
    }),
  );

  it.live("takes the crew whole, with every crewmate's agent asked", () =>
    Effect.gen(function* () {
      const held = yield* cached;
      expect(held.crew.order).toEqual(["lead", "ana", "bob", "cy", "dee"]);
      expect(held.crew.run).toMatchObject({ state: "paused", reasonDetail: UPDATE_PAUSE });
      expect(held.crew.claims["appdev"]).toMatchObject({ devServer: { port: 3000 } });
      expect(held.crew.effects).toBe(0);
    }),
  );

  it.live("leaves V1's crew tables as they were, so flipping back finds the crew", () =>
    Effect.gen(function* () {
      const file = yield* seeded("crew-v1-unchanged");
      const tables = v1CrewTables.pipe(Effect.provide(NodeSqliteClient.layer({ filename: file })));
      const before = yield* tables;
      yield* lifetime(file, ({ worker, flip }) => Effect.andThen(flip, drain(worker)));
      expect(yield* tables).toEqual(before);
    }),
  );

  it.live(
    "a re-run imports nothing: a second flip finds its crew and its records as they are",
    () =>
      Effect.gen(function* () {
        const file = yield* seeded("crew-twice");
        const first = yield* lifetime(file, ({ worker, flip }) =>
          Effect.gen(function* () {
            yield* flip;
            yield* drain(worker);
            return yield* heldAfter;
          }),
        );
        const second = yield* lifetime(file, ({ worker, flip }) =>
          Effect.gen(function* () {
            const report = yield* flip;
            yield* drain(worker);
            return { report, held: yield* heldAfter };
          }),
        );
        expect(second.report).toMatchObject({ crew: true, turns: 0 });
        expect(second.held).toEqual(first);
      }),
  );
});

// ── the crash table ─────────────────────────────────────────────────────────────────────────

type Crash =
  | { readonly at: number; readonly how: "after" | "mid-effect" | "outcome-unrecorded" }
  | { readonly at: number; readonly how: "mid-commit"; readonly stage: CommitStage };

const STAGES: ReadonlyArray<CommitStage> = [
  "receipt",
  "events",
  "projections",
  "outbox",
  "settle",
  "snapshot",
];

/**
 * The flip's moves: the flip itself (two chains asked, then the crew's step), then the worker's,
 * one effect each — the chains' nine batches, then the crew's twelve: five agents, the claim's
 * read, two sweeps, and four sessions started from their packets.
 */
const MOVES = 1 + 21;

const crashes: ReadonlyArray<Crash> = Array.from({ length: MOVES }, (_, move) => move).flatMap(
  (move): ReadonlyArray<Crash> => [
    { at: move, how: "after" },
    ...(move > 0
      ? [{ at: move, how: "mid-effect" } as const, { at: move, how: "outcome-unrecorded" } as const]
      : []),
    ...STAGES.map((stage) => ({ at: move, how: "mid-commit", stage }) as const),
  ],
);

/** The flip's first move commits three steps: a crash may fall in any of them. */
const FLIP_COMMITS = [0, 1, 2];

describe("the crew import's crash table", () => {
  it.live(
    "a restart at any of its step boundaries imports the crew once, whole",
    () =>
      Effect.gen(function* () {
        const expected = yield* cached;
        const broken: Array<string> = [];
        const table = crashes.flatMap((crash) =>
          crash.at === 0 && crash.how === "mid-commit"
            ? FLIP_COMMITS.map((commit) => ({ ...crash, commit }))
            : [{ ...crash, commit: 0 }],
        );
        for (const crash of table) {
          const file = yield* seeded("crew-crash");
          let armed = false;
          let commits = 0;
          let acted = false;
          const label = `${crash.at} ${crash.at === 0 ? `flip#${crash.commit}` : "worker"} — ${crash.how}${crash.how === "mid-commit" ? `@${crash.stage}` : ""}`;
          yield* lifetime(
            file,
            ({ worker, flip }) =>
              Effect.gen(function* () {
                for (let move = 0; move <= crash.at; move++) {
                  armed = move === crash.at;
                  if (armed && crash.how === "mid-effect") {
                    yield* Effect.forkDetach(worker.runOnce);
                    for (let spin = 0; spin < 200; spin++) {
                      if (acted) break;
                      yield* Effect.sleep(5);
                    }
                    return;
                  }
                  if (move === 0) yield* Effect.exit(flip);
                  else yield* Effect.exit(worker.runOnce);
                }
              }),
            {
              fault: (stage) => {
                if (!armed || crash.how !== "mid-commit" || stage !== crash.stage)
                  return Effect.void;
                const commit = commits++;
                return commit === crash.commit
                  ? Effect.fail(
                      new EngineStoreError({
                        operation: "commit",
                        cause: new Error("process died"),
                      }),
                    )
                  : Effect.void;
              },
              tell: (tell) => (envelope) => {
                if (!armed) return tell(envelope);
                if (crash.how === "mid-effect" && envelope.command._tag === "HistoryBatch")
                  return Effect.andThen(
                    tell(envelope),
                    Effect.suspend(() => {
                      acted = true;
                      return Effect.never;
                    }),
                  );
                if (crash.how === "outcome-unrecorded" && envelope.command._tag === "EffectSettled")
                  return Effect.die("process died before the outcome was recorded");
                return tell(envelope);
              },
            },
          );
          const after = yield* lifetime(file, ({ worker, flip }) =>
            Effect.gen(function* () {
              yield* drain(worker);
              // Whatever the crash cut, the next boot's flip goes on where it stands.
              yield* flip;
              yield* drain(worker);
              return yield* heldAfter;
            }),
          );
          if (!same(after, expected)) {
            broken.push(label);
          }
        }
        expect(broken).toEqual([]);
      }),
    // About two hundred crashes, two server lifetimes each: under a gate's parallel stages it
    // outlasts the default deadline.
    { timeout: 600_000 },
  );
});
