// @effect-diagnostics globalConsoleInEffect:off - a seed's trace prints when asked.
/**
 * Deterministic simulation: one conversation, the real actor, store, outbox and worker over a
 * SQLite file, and a scripted driver whose turns know which run they serve. A seeded schedule
 * interleaves people (send, Stop, answer), the worker, the driver, the clock and faults — a driver
 * crash, a slow driver, a lost batch, a batch the pump delivers twice, an item after its turn's end
 * (the bridge's `afterEnd`), a usage limit that parks the turn (Claude), a failed interrupt, and a
 * server restart. Every step checks that what a turn's signal did landed on that turn's run; the
 * end checks liveness, delivery and the store. A second owner, a crew (the test kind), runs beside
 * the conversation on the same store, worker and scheduler: it queues effects on its own lanes and
 * arms wakes on its own schedule, and every invariant holds for it too.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  ConversationId,
  type EffectOutcome,
  type KnownEngineEvent,
  type Principal,
  type RequestId,
  type RunId,
  type SessionId,
  type TurnHandle,
} from "@t3tools/contracts";

import { Conversations } from "./Conversations.ts";
import type { Command, ProviderSignal } from "./domain/command.ts";
import { signalsCommandId } from "./domain/ids.ts";
import type { EffectRow } from "./outbox/EffectOutbox.ts";
import { handlersOf, makeEffectWorker, type HandlerResult } from "./outbox/EffectWorker.ts";
import { EngineStore } from "./store/EngineStore.ts";
import { tallyDomain, tallyOwner } from "./testing/tallyOwner.ts";
import {
  World,
  audit,
  auditOwner,
  engineLayer,
  fireDue,
  newBoot,
  tempDb,
} from "./testing/world.ts";
import { gateSeeds, makeRng, type Rng } from "./testing/rng.ts";

const c = ConversationId.make("mate");
const ana: Principal = { kind: "person", subject: "ana" };
const MIN = 60_000;

interface Turn {
  readonly id: string;
  readonly turn: TurnHandle;
  readonly runId: string;
  readonly session: string;
  readonly script: Array<ProviderSignal>;
  blockedOn: string | null;
  parkedUntil: number | null;
}

interface Batch {
  readonly session: string;
  readonly signals: ReadonlyArray<ProviderSignal>;
  /** The run the turn that said it serves; null for a driver-level signal. */
  readonly serves: string | null;
  readonly note: string;
}

export interface Faults {
  readonly crashDriver: number;
  readonly loseBatch: number;
  readonly duplicateBatch: number;
  readonly lateItem: number;
  readonly parkOnLimit: number;
  readonly failInterrupt: number;
  readonly restart: number;
}

const NO_FAULTS: Faults = {
  crashDriver: 0,
  loseBatch: 0,
  duplicateBatch: 0,
  lateItem: 0,
  parkOnLimit: 0,
  failInterrupt: 0,
  restart: 0,
};

/** The scripted driver: turns that know their run, over the world's sessions. */
class Driver {
  readonly turns: Array<Turn> = [];
  readonly later: Array<Batch> = [];
  private count = 0;
  faults: Faults;
  readonly rng: Rng;
  readonly world: World;
  constructor(rng: Rng, world: World, faults: Faults) {
    this.rng = rng;
    this.world = world;
    this.faults = faults;
  }

  handlers() {
    const ok = (value?: unknown): HandlerResult => ({
      _tag: "Done",
      outcome: (value === undefined ? { kind: "ok" } : { kind: "ok", value }) as EffectOutcome,
    });
    const failed = (reason: string): HandlerResult => ({
      _tag: "Done",
      outcome: { kind: "failed", reason },
    });
    const alive = (session: string) => this.world.sessions.get(session)?.alive === true;
    return handlersOf(
      ...this.world.handlers().values(),
      {
        kind: "provider.send",
        run: (row: EffectRow) =>
          Effect.sync(() => {
            const p = row.payload as {
              readonly sessionId: string;
              readonly text: string;
              readonly runId: string;
              readonly turn: TurnHandle;
            };
            if (!alive(p.sessionId)) return failed("no live session");
            this.world.act(row);
            this.world.received.push({ session: p.sessionId, text: p.text });
            const id = `T${++this.count}`;
            const turn = p.turn;
            const script: Array<ProviderSignal> = [
              { kind: "turn-started", turn, origin: "engine", providerTurnId: id },
              {
                kind: "item-opened",
                turn,
                key: `${id}-note`,
                by: { kind: "mate" },
                body: { kind: "note", text: "working", streaming: true, answer: false },
              },
            ];
            if (this.rng.chance(0.25)) {
              script.push({
                kind: "request-opened",
                turn,
                key: `${id}-q`,
                ask: { kind: "approval", requestKind: "command", detail: "deploy" },
              });
            }
            script.push(
              {
                kind: "item-closed",
                turn,
                key: `${id}-note`,
                body: { kind: "note", text: "done", streaming: false, answer: true },
              },
              { kind: "turn-ended", turn, outcome: { kind: "completed" }, source: "agent" },
            );
            this.turns.push({
              id,
              turn,
              runId: p.runId,
              session: p.sessionId,
              script,
              blockedOn: null,
              parkedUntil: null,
            });
            return ok({ providerTurnId: id });
          }),
      },
      {
        kind: "provider.interrupt",
        run: (row: EffectRow) =>
          Effect.sync(() => {
            this.world.act(row);
            const p = row.payload as { readonly runId: string };
            if (this.rng.chance(this.faults.failInterrupt)) return failed("interrupt timed out");
            const turn = this.turns.find((t) => t.runId === p.runId);
            if (turn !== undefined) {
              turn.script.splice(0, turn.script.length, {
                kind: "turn-ended",
                turn: turn.turn,
                outcome: { kind: "interrupted" },
                source: "stop-confirmed",
              });
              turn.blockedOn = null;
              turn.parkedUntil = null;
            }
            return ok();
          }),
      },
      {
        kind: "provider.respond",
        run: (row: EffectRow) =>
          Effect.sync(() => {
            this.world.act(row);
            const p = row.payload as { readonly key: string };
            const turn = this.turns.find((t) => t.blockedOn === p.key);
            if (turn !== undefined) turn.blockedOn = null;
            return ok();
          }),
      },
    );
  }

  /** The next batch the driver says, with faults; null when it has nothing to say. */
  step(now: number): Batch | null {
    const late = this.later.shift();
    if (late !== undefined && this.rng.chance(0.5)) return late;
    if (late !== undefined) this.later.unshift(late);
    const turn = this.turns.find(
      (t) =>
        this.world.sessions.get(t.session)?.alive === true &&
        t.blockedOn === null &&
        (t.parkedUntil === null || t.parkedUntil <= now),
    );
    if (turn === undefined) return this.later.shift() ?? null;
    turn.parkedUntil = null;
    if (this.rng.chance(this.faults.crashDriver)) {
      this.world.sessions.get(turn.session)!.alive = false;
      for (const t of this.turns.filter((t) => t.session === turn.session))
        this.turns.splice(this.turns.indexOf(t), 1);
      return {
        session: turn.session,
        signals: [{ kind: "session-exited", reason: "exit 137" }],
        serves: null,
        note: "driver crashed",
      };
    }
    const next = turn.script[0]!;
    if (next.kind !== "turn-started" && this.rng.chance(this.faults.parkOnLimit)) {
      // Claude parks the turn on a usage limit: no end now; it goes on after the reset.
      turn.parkedUntil = now + 30 * MIN;
      return {
        session: turn.session,
        signals: [{ kind: "usage-limit", turn: turn.turn, resetsAt: turn.parkedUntil }],
        serves: turn.runId,
        note: "limit parks the turn",
      };
    }
    turn.script.shift();
    if (next.kind === "request-opened") turn.blockedOn = next.key;
    if (next.kind === "turn-ended") {
      this.turns.splice(this.turns.indexOf(turn), 1);
      if (this.rng.chance(this.faults.lateItem)) {
        this.later.push({
          session: turn.session,
          signals: [
            {
              kind: "item-closed",
              turn: turn.turn,
              key: `${turn.id}-late`,
              body: { kind: "note", text: "one more thing", streaming: false, answer: false },
              afterEnd: true,
            },
          ],
          serves: turn.runId,
          note: "item after its turn's end",
        });
      }
    }
    const batch: Batch = {
      session: turn.session,
      signals: [next],
      serves: turn.runId,
      note: `${turn.id} ${next.kind}`,
    };
    if (this.rng.chance(this.faults.duplicateBatch))
      this.later.push({ ...batch, note: `${batch.note} (delivered again)` });
    if (this.rng.chance(this.faults.loseBatch) && next.kind !== "turn-ended") return null;
    return batch;
  }

  /** The process died: the driver processes died with it. */
  crash() {
    this.world.crash();
    this.turns.splice(0);
    this.later.splice(0);
  }
}

interface SimResult {
  readonly broken: Array<string>;
  readonly steps: number;
}

const attribution = (
  batch: Batch,
  events: ReadonlyArray<KnownEngineEvent>,
  broken: Array<string>,
  step: number,
) => {
  if (batch.serves === null) return;
  for (const e of events) {
    const wrong = (what: string, run: string) =>
      broken.push(
        `step ${step}: a turn's signal lands on its own run — ${batch.note} for ${short(batch.serves!)} ${what} ${short(run)}`,
      );
    if (
      e._tag === "RunEnded" &&
      (e.source === "agent" || e.source === "stop-confirmed") &&
      e.runId !== batch.serves
    )
      wrong(`ended`, e.runId);
    if (e._tag === "RunStarted" && e.runId !== batch.serves) wrong("started", e.runId);
    if (e._tag === "ItemOpened" && e.by.kind === "mate" && e.runId !== batch.serves)
      wrong("filed an item under", e.runId ?? "none");
  }
};
const short = (run: string | null) => (run ?? "none").split("/").slice(-2).join("/");
const describe_ = (e: KnownEngineEvent): string => {
  switch (e._tag) {
    case "RunQueued":
      return `${short(e.runId)} queued`;
    case "RunAdmitted":
      return `${short(e.runId)} admitted`;
    case "RunSending":
      return `${short(e.runId)} sending`;
    case "RunStarted":
      return `${short(e.runId)} started`;
    case "RunWaiting":
      return `${short(e.runId)} waiting`;
    case "RunResumed":
      return `${short(e.runId)} resumed`;
    case "RunEnded":
      return `${short(e.runId)} ENDED ${e.end.kind}/${e.source}`;
    case "EffectRequested":
      return `asks ${e.kind}`;
    case "EffectOutcomeRecorded":
      return `${e.kind} ${e.outcome.kind}`;
    case "ItemOpened":
      return e.body.kind === "person" ? "" : `item under ${short(e.runId)}`;
    case "SessionOpened":
      return `session ${e.sessionId} opened`;
    case "SessionClosed":
      return `session ${e.sessionId} closed (${e.reason})`;
    case "RunStopAsked":
      return `${short(e.runId)} stop asked`;
    default:
      return "";
  }
};

/** One seed: a schedule of people, worker, driver, clock and faults; then a fault-free drain. */
const simulate = (seed: number, steps: number, faults: Faults) =>
  Effect.gen(function* () {
    const rng = makeRng(seed);
    // The crew's schedule draws from its own stream: the conversation's stays the seed's.
    const crewRng = makeRng(seed * 7919 + 1);
    const world = new World();
    const driver = new Driver(rng, world, faults);
    const file = tempDb(`sim-${seed}`);
    const domains = [tallyDomain];
    let crewAsks = 0;
    let crewWakes = 0;
    /** The crew's own step: an effect on one of its lanes, or a wake a few minutes out. */
    const crewAct = (now: number) =>
      Effect.gen(function* () {
        const crew = (yield* Conversations).owner(tallyDomain);
        const ask = crewRng.chance(0.7);
        const n = ask ? ++crewAsks : ++crewWakes;
        yield* Effect.exit(
          crew.ask({
            commandId: CommandId.make(`crew-${seed}-${ask ? "ask" : "arm"}-${n}`),
            conversationId: tallyOwner,
            principal: { kind: "crew", startedBy: "ana" },
            command: ask
              ? {
                  _tag: "Ask",
                  kind: "test.replay",
                  lane: crewRng.pick(["git/ana", "check/ana", "deliver/ana", "git/bo", "host/h1"]),
                  key: `k${n}`,
                }
              : { _tag: "Arm", key: `w${n}`, dueAt: now + crewRng.pick([1, 5, 20]) * MIN },
          }),
        );
        log(`crew ${ask ? `asks k${n}` : `arms w${n}`}`);
      });
    const broken: Array<string> = [];
    const accepted: Array<string> = [];
    let batches = 0;
    let texts = 0;
    let step = 0;
    let firstLife = true;
    const trace: Array<string> = [];
    const log = (line: string) => trace.push(`${String(step).padStart(4)} ${line}`);

    type Action = "send" | "stop" | "answer" | "work" | "driver" | "clock" | "restart";
    let progressed = false;
    const tick = (
      worker: Pick<Effect.Success<ReturnType<typeof makeEffectWorker>>, "runOnce">,
      forced?: Action,
    ) =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const store = yield* EngineStore;
        const sql = yield* SqlClient.SqlClient;
        const now = yield* Clock.currentTimeMillis;
        progressed = false;
        const action: Action =
          forced ??
          rng.weighted([
            ["send", 1.2],
            ["stop", process.env.ENGINE_PROOF_SIM_NO_STOP ? 0 : 0.4],
            ["answer", 0.6],
            ["work", 3],
            ["driver", 3],
            ["clock", 1],
            ["restart", faults.restart * 100],
          ] as const);
        if (action === "restart") return "restart" as const;
        if (forced === undefined && crewRng.chance(0.2)) yield* crewAct(now);
        if (action === "clock" && forced !== undefined) {
          // Drain: jump to the next thing the clock holds (a parked turn, a due wake), if any.
          const [wake] = yield* sql<{
            readonly due_at: number;
          }>`SELECT min(due_at) AS due_at FROM engine_wake WHERE state = 'armed'`;
          // A parked turn holds the clock only until its time: one past it (its session gone)
          // never stops the clock reaching the next wake.
          const parked = driver.turns.flatMap((t) =>
            t.parkedUntil !== null && t.parkedUntil > now ? [t.parkedUntil] : [],
          );
          const next = Math.min(wake?.due_at ?? Infinity, ...parked);
          if (next === Infinity || next - now > 6 * 3_600_000) return "ok" as const;
          if (next > now) yield* TestClock.adjust(next - now);
          const fired = yield* fireDue(yield* Clock.currentTimeMillis);
          progressed = fired > 0 || parked.length > 0;
          return "ok" as const;
        }
        const state = yield* store.load(c);
        switch (action) {
          case "send": {
            const text = `msg-${++texts}`;
            const exit = yield* Effect.exit(
              conversations.ask({
                commandId: CommandId.make(`send-${seed}-${texts}`),
                conversationId: c,
                principal: ana,
                command: { _tag: "Send", text },
              }),
            );
            if (Exit.isSuccess(exit)) accepted.push(text);
            log(
              `person sends "${text}" → ${Exit.isSuccess(exit) ? short(exit.value.runId ?? "") : "refused"}`,
            );
            return "ok" as const;
          }
          case "stop": {
            if (state.activeRunId === null) return "ok" as const;
            yield* Effect.exit(
              conversations.ask({
                commandId: CommandId.make(`stop-${seed}-${step}`),
                conversationId: c,
                principal: ana,
                command: { _tag: "Stop" },
              }),
            );
            log(`person presses Stop on ${short(state.activeRunId)}`);
            return "ok" as const;
          }
          case "answer": {
            const request = Object.values(state.requests).find((r) => r.answerable);
            if (request === undefined) return "ok" as const;
            progressed = true;
            const command: Command = {
              _tag: "Answer",
              requestId: request.id as RequestId,
              answer: "yes",
              summary: "yes",
            };
            yield* Effect.exit(
              conversations.ask({
                commandId: CommandId.make(`answer-${seed}-${step}`),
                conversationId: c,
                principal: ana,
                command,
              }),
            );
            log(`person answers ${short(request.id)}`);
            return "ok" as const;
          }
          case "work": {
            const [head] = yield* sql<{
              readonly head_seq: number;
            }>`SELECT head_seq FROM engine_conversation WHERE conversation_id = ${c}`;
            const exit = yield* Effect.exit(worker.runOnce);
            progressed = Exit.isSuccess(exit) && exit.value;
            const events = (yield* store.events(
              c,
              head?.head_seq ?? 0,
            )) as ReadonlyArray<KnownEngineEvent>;
            if (Exit.isSuccess(exit) && exit.value)
              log(
                `worker: ${events
                  .map(describe_)
                  .filter((x) => x !== "")
                  .join(", ")}`,
              );
            return "ok" as const;
          }
          case "driver": {
            const batch = driver.step(now);
            if (batch === null) return "ok" as const;
            progressed = true;
            const [head] = yield* sql<{
              readonly head_seq: number;
            }>`SELECT head_seq FROM engine_conversation WHERE conversation_id = ${c}`;
            yield* Effect.exit(
              conversations.tell({
                commandId: signalsCommandId(batch.session as SessionId, ++batches),
                conversationId: c,
                principal: { kind: "engine" },
                command: {
                  _tag: "ProviderSignals",
                  sessionId: batch.session as SessionId,
                  signals: batch.signals,
                },
              }),
            );
            const events = (yield* store.events(
              c,
              head?.head_seq ?? 0,
            )) as ReadonlyArray<KnownEngineEvent>;
            log(
              `driver ${batch.session}: ${batch.note} → ${
                events
                  .map(describe_)
                  .filter((x) => x !== "")
                  .join(", ") || "nothing"
              }`,
            );
            attribution(batch, events, broken, step);
            return "ok" as const;
          }
          case "clock": {
            const by = rng.pick([5_000, 2 * MIN, 11 * MIN, 31 * MIN]);
            yield* TestClock.adjust(by);
            const fired = yield* fireDue(yield* Clock.currentTimeMillis);
            if (fired > 0) log(`clock +${by / 1000}s fires ${fired} wake(s)`);
            return "ok" as const;
          }
        }
      });

    /** One process lifetime: its share of the schedule, then (if it lives) the fault-free drain. */
    const lifetime = (budget: number) =>
      Effect.gen(function* () {
        const worker = yield* makeEffectWorker(newBoot());
        if (!firstLife) yield* worker.reconcileAtBoot();
        firstLife = false;
        for (let i = 0; i < budget; i++) {
          step++;
          if ((yield* tick(worker)) === "restart") return "restart" as const;
        }
        driver.faults = NO_FAULTS;
        // Drain to quiescence: the worker, the driver, people answering, then the clock.
        for (let round = 0; round < 5_000; round++) {
          let any = false;
          for (const action of ["work", "driver", "answer", "clock"] as const) {
            step++;
            yield* tick(worker, action);
            if (progressed) {
              any = true;
              break;
            }
          }
          if (!any) break;
        }
        return "done" as const;
      }).pipe(Effect.provide(engineLayer(file, driver.handlers(), {}, domains)));

    let remaining = steps;
    for (;;) {
      const before = step;
      const end = yield* lifetime(remaining);
      remaining = Math.max(0, remaining - (step - before));
      if (end === "done") break;
      driver.crash();
      log("— the server restarts —");
    }

    // ── the end: liveness, delivery, re-sends, the store ──
    const result = yield* audit(c).pipe(
      Effect.provide(engineLayer(file, driver.handlers(), {}, domains)),
    );
    broken.push(...result.problems);
    // The second owner: its record, every effect it asked settled once, every wake fired.
    const crew = yield* auditOwner(tallyDomain, tallyOwner, (state) =>
      Object.keys(state.wakes),
    ).pipe(Effect.provide(engineLayer(file, driver.handlers(), {}, domains)));
    broken.push(...crew.problems.map((problem) => `crew ${problem}`));
    if (crew.recorded.size !== crewAsks)
      broken.push(`crew effects settle: ${crew.recorded.size} of ${crewAsks} recorded`);
    if (Object.keys(crew.state.wakes).length > 0)
      broken.push(`crew wakes fire: ${Object.keys(crew.state.wakes).join(", ")} still armed`);
    const boots = crew.events.flatMap((e) => (e._tag === "TallyRecovered" ? [e.bootId] : []));
    if (new Set(boots).size !== boots.length)
      broken.push(`crew recovers once per boot: ${boots.join(", ")}`);
    const { state, events } = result;
    for (const run of Object.values(state.runs)) {
      if (run.state === "ended" || run.state === "queued") continue;
      // No timer ends a run; a run whose evidence never came must at least be marked.
      if (run.unresponsiveSince === null)
        broken.push(
          `a run left without evidence is marked unresponsive: ${short(run.id)} left ${run.state}`,
        );
    }
    for (const [effect, count] of world.acts)
      if (count > 1) broken.push(`never re-sent: ${effect} acted ${count} times`);
    const refused = new Set(
      events.flatMap((e) =>
        (e._tag === "ItemUpdated" || e._tag === "ItemClosed") &&
        e.body.kind === "person" &&
        e.body.delivery.state === "refused"
          ? [e.body.text]
          : [],
      ),
    );
    for (const text of accepted) {
      const got = world.received.filter((r) => r.text === text).length;
      if (got > 1) broken.push(`a message reaches the agent at most once: "${text}" ×${got}`);
      if (got === 0 && !refused.has(text)) {
        const opened = events.find(
          (e) => e._tag === "ItemOpened" && e.body.kind === "person" && e.body.text === text,
        );
        const run = (opened?._tag === "ItemOpened" ? opened.runId : undefined) as RunId | undefined;
        const ended = events.find((e) => e._tag === "RunEnded" && e.runId === run);
        const end = ended?._tag === "RunEnded" ? ended.end.kind : state.runs[run ?? ""]?.state;
        // Queued behind a run stuck without evidence: only a person's Stop moves it (rule 5).
        const blocked = end === "queued" && state.activeRunId !== null;
        if (end !== "stopped" && !blocked)
          broken.push(
            `a message reaches the agent or reads refused: "${text}" (run ${end ?? "?"})`,
          );
      }
    }
    if (process.env.ENGINE_PROOF_TRACE) console.log(trace.join("\n"));
    return { broken, steps: step } satisfies SimResult;
  });

const SEEDS = gateSeeds(Number(process.env.ENGINE_PROOF_SIM_SEEDS ?? 6));
const STEPS = Number(process.env.ENGINE_PROOF_SIM_STEPS ?? 120);

const schedules: ReadonlyArray<readonly [string, Faults]> = [
  ["no faults", NO_FAULTS],
  ["driver crash", { ...NO_FAULTS, crashDriver: 0.04 }],
  ["slow driver and lost batches", { ...NO_FAULTS, loseBatch: 0.05 }],
  ["batches delivered twice", { ...NO_FAULTS, duplicateBatch: 0.08 }],
  ["items after their turn's end", { ...NO_FAULTS, lateItem: 0.3 }],
  ["usage limit parks the turn", { ...NO_FAULTS, parkOnLimit: 0.05 }],
  ["Stop races the turn's end", { ...NO_FAULTS, failInterrupt: 0.3 }],
  ["server restarts", { ...NO_FAULTS, restart: 0.006 }],
];

describe("deterministic simulation under seeded fault schedules", () => {
  it.effect.each(schedules)("%s: every invariant holds", ([name, faults]) =>
    Effect.gen(function* () {
      const failures: Array<string> = [];
      const byRule = new Map<string, { seeds: number; first: string }>();
      for (const seed of SEEDS) {
        const { broken } = yield* simulate(seed, STEPS, faults);
        if (broken.length > 0)
          failures.push(
            `seed ${seed} (ENGINE_PROOF_SEED=${seed}): ${broken[0]}${broken.length > 1 ? ` (+${broken.length - 1} more)` : ""}`,
          );
        const rules = new Set(
          broken.map((line) => line.replace(/^step \d+: /, "").split(/ — |: /)[0]!),
        );
        for (const rule of rules) {
          const known = byRule.get(rule);
          const first = broken.find((line) => line.replace(/^step \d+: /, "").startsWith(rule))!;
          byRule.set(rule, {
            seeds: (known?.seeds ?? 0) + 1,
            first: known?.first ?? `seed ${seed}: ${first}`,
          });
        }
      }
      if (process.env.ENGINE_PROOF_PRINT) {
        console.log(
          `[${name}] ${failures.length}/${SEEDS.length} seeds broke an invariant\n${[...byRule].map(([rule, { seeds, first }]) => `  ${rule} — ${seeds} seeds; e.g. ${first}`).join("\n")}`,
        );
      }
      expect(failures).toEqual([]);
    }),
  );
});
