/**
 * The trees: a seeded walk of what a Mate and its person do — the Mate's turn starts helpers and
 * background commands, helpers run calls and start their own commands (and helpers), each piece
 * of work ends its own way (finished, failed with an exit code, stopped by the Mate, lost to a
 * restart or a crash), an end after the turn wakes the Mate (whose wake turn starts more), and the
 * person sends, steers, stops and reloads between it all, while the server may restart.
 *
 * A tree is a list of ops. Each op says what happens, never whether it can: the player skips an
 * op its moment does not allow (an end of work that already ended, a call with no turn open), so
 * any sub-list of a tree is a tree — what minimising a failure needs.
 */
import * as Effect from "effect/Effect";
import { runId } from "@t3tools/contracts";

import { mate } from "../../../server/src/engine/testing/pump/engineWorld.ts";
import { makeRng, type Rng } from "../../../server/src/engine/testing/rng.ts";
import * as claude from "./claude.ts";
import type { OracleWorld } from "./world.ts";

export type End = "completed" | "failed" | "stopped";

export type Op =
  | { readonly op: "send"; readonly text: string }
  | { readonly op: "steer"; readonly text: string }
  | { readonly op: "say" }
  | {
      readonly op: "call";
      readonly id: string;
      readonly helper: string | null;
      readonly fail: boolean;
    }
  /** A command sent to the background; its task is told before its call returns, or after. */
  | {
      readonly op: "job";
      readonly id: string;
      readonly helper: string | null;
      readonly told: "before" | "after";
    }
  | { readonly op: "helper"; readonly id: string; readonly parent: string | null }
  | { readonly op: "progress"; readonly id: string }
  | { readonly op: "end"; readonly id: string; readonly how: End; readonly exit: number }
  /** The Mate's TaskStop on its job: the kill, and (or not) the notification after it. */
  | { readonly op: "taskStop"; readonly id: string; readonly notified: boolean }
  | { readonly op: "finish" }
  /** Claude opens a turn of its own to hand the Mate what ended. */
  | { readonly op: "wake" }
  | { readonly op: "stop" }
  | { readonly op: "reload" }
  | { readonly op: "restart" }
  /** The agent's process dies. */
  | { readonly op: "crash" }
  | { readonly op: "wait"; readonly ms: number };

export type Status = "running" | "completed" | "failed" | "stopped" | "lost";

/** A piece of the tree as it happened: who started it, on which card it belongs, how it stands. */
export interface Entity {
  readonly id: string;
  readonly kind: "call" | "job" | "helper";
  /** The helper whose own it is; null: the Mate's. */
  readonly owner: string | null;
  readonly task?: claude.TaskLinkage;
  /** A helper's launch call: its own calls run under it. */
  readonly launch?: string;
  /** The card it belongs on: the card of the run it served. */
  readonly card: string | null;
  readonly run: string | null;
  status: Status;
  exit?: number;
  failed?: boolean;
}

export interface Model {
  readonly entities: Map<string, Entity>;
  /** The card each run draws on, as the tree knows it. */
  readonly cardOfRun: Map<string, string>;
  /** Runs whose card the tree cannot tell, as the engine joined them. */
  readonly loose: Set<string>;
  /** What ended last, since the Mate's last turn: what a wake hands the Mate. */
  ended: Array<Entity>;
  /** The work a wake handed the Mate, by the turn it opened. */
  wakeOf: Entity | null;
  /** Work lost since the last lost-work wake, by card. */
  lostCards: Set<string>;
  wakes: number;
  played: Array<Op>;
  skipped: number;
}

export const emptyModel = (): Model => ({
  entities: new Map(),
  cardOfRun: new Map(),
  loose: new Set(),
  ended: [],
  wakeOf: null,
  lostCards: new Set(),
  wakes: 0,
  played: [],
  skipped: 0,
});

interface EngineRun {
  readonly id: string;
  readonly state: string;
  readonly joins: string | null;
  readonly trigger: { readonly kind: string; readonly cause?: string };
}

/** The engine's runs, oldest first. */
const runsOf = (world: OracleWorld) =>
  Effect.gen(function* () {
    const rows = yield* world.w.runs;
    const runs: EngineRun[] = [];
    for (const row of rows) {
      const run = yield* world.w.run(row.run_id as never);
      if (run !== undefined)
        runs.push({ id: row.run_id, state: run.state, joins: run.joins, trigger: run.trigger });
    }
    return runs;
  });

const LIVE_RUN: ReadonlySet<string> = new Set(["running", "waiting"]);

/** How long each step of a tree takes. */
const STEP_MS = 300;

/** Each run the engine opened since: the card the tree says it belongs on. */
const learnRuns = (world: OracleWorld, model: Model) =>
  Effect.gen(function* () {
    const runs = yield* runsOf(world);
    const rootOf = (id: string): string => {
      let at = runs.find((run) => run.id === id);
      for (let hops = 0; at?.joins != null && hops < runs.length; hops++)
        at = runs.find((run) => run.id === at!.joins) ?? at;
      return at?.id ?? id;
    };
    for (const run of runs) {
      if (model.cardOfRun.has(run.id)) continue;
      if (run.trigger.kind === "person") {
        model.cardOfRun.set(run.id, run.id);
      } else if (run.trigger.kind === "wake" && run.trigger.cause === "self" && model.wakeOf) {
        // The wake hands the Mate what ended: it goes on on that work's card.
        model.cardOfRun.set(run.id, model.wakeOf.card ?? rootOf(run.id));
        model.wakeOf = null;
      } else if (run.trigger.kind === "wake" && run.trigger.cause === "lost-work") {
        // The note of lost work goes on on the card of the run the work served while that run is
        // the latest; else it is a card of its own (`noteLostWork`).
        const root = rootOf(run.id);
        model.cardOfRun.set(
          run.id,
          run.joins === null || model.lostCards.has(root)
            ? root
            : ([...model.lostCards][0] ?? root),
        );
        model.lostCards.clear();
      } else {
        model.cardOfRun.set(run.id, rootOf(run.id));
        model.loose.add(run.id);
      }
    }
    return runs;
  });

const activeRunOf = (runs: ReadonlyArray<EngineRun>) =>
  runs.findLast((run) => LIVE_RUN.has(run.state)) ?? null;

const NAMES: Record<Entity["kind"], (id: string) => string> = {
  call: (id) => `Check ${id}`,
  job: (id) => `Background job ${id}`,
  helper: (id) => `Helper ${id} looks into it`,
};

/** Plays one op on the world; false when its moment does not allow it. */
export const play = (world: OracleWorld, model: Model, op: Op) =>
  Effect.gen(function* () {
    const { w } = world;
    const session = () => w.provider.sessions.get(w.thread);
    const alive = () => session()?.alive === true;
    const turnOpen = () => alive() && session()!.open !== null;
    const runs = yield* learnRuns(world, model);
    const active = activeRunOf(runs);
    const live = (id: string) => {
      const entity = model.entities.get(id);
      return entity !== undefined && entity.status === "running" ? entity : undefined;
    };
    /** Where a new piece of the Mate's own goes: the live run's card. */
    const mateCard = () =>
      active === null
        ? null
        : { run: active.id, card: model.cardOfRun.get(active.id) ?? active.id };
    const ownerOf = (helper: string | null) => (helper === null ? null : live(helper));
    const allowedOwner = (helper: string | null) =>
      helper === null ? turnOpen() : alive() && ownerOf(helper) !== undefined;
    const placeOf = (helper: string | null) => {
      if (helper === null) return mateCard();
      const owner = live(helper)!;
      return { run: owner.run, card: owner.card };
    };
    const ending = (entity: Entity, status: Status) => {
      entity.status = status;
      if (status === "lost" && entity.card !== null) model.lostCards.add(entity.card);
      // Only work that reported its own end hands the Mate something to wake to.
      if (status === "completed" || status === "failed") model.ended.push(entity);
    };
    /** The session went: its work with it, and nothing it ended wakes the Mate any more. */
    const markAll = (status: Status) => {
      for (const entity of model.entities.values())
        if (entity.status === "running" && entity.kind !== "call") ending(entity, status);
      model.ended = [];
    };

    switch (op.op) {
      case "send":
        yield* world.person.send(op.text);
        break;
      case "steer": {
        if (active === null || !turnOpen()) return false;
        yield* world.person.steer(active.id, op.text);
        break;
      }
      case "say": {
        if (!turnOpen()) return false;
        yield* w.agent((agent, thread) => agent.say(thread, "Working on it."));
        break;
      }
      case "call": {
        if (model.entities.has(op.id) || !allowedOwner(op.helper)) return false;
        const owner = ownerOf(op.helper);
        const place = placeOf(op.helper);
        model.entities.set(op.id, {
          id: op.id,
          kind: "call",
          owner: op.helper,
          card: place?.card ?? null,
          run: place?.run ?? null,
          status: op.fail ? "failed" : "completed",
        });
        yield* claude.call(w, {
          id: `toolu_${op.id}`,
          owner:
            owner === undefined || owner === null
              ? null
              : { helper: owner.task!.taskId, launch: owner.launch! },
          tool: "Bash",
          args: { command: `test -e /srv/${op.id}`, description: NAMES.call(op.id) },
          result: op.fail ? "Exit code 1" : "",
          failed: op.fail,
        });
        break;
      }
      case "job": {
        if (model.entities.has(op.id) || !allowedOwner(op.helper)) return false;
        const owner = ownerOf(op.helper);
        const place = placeOf(op.helper);
        const task: claude.TaskLinkage = {
          taskId: `b${op.id}`,
          taskType: "local_bash",
          title: NAMES.job(op.id),
          toolUseId: `toolu_${op.id}`,
          ...(owner === undefined || owner === null ? {} : { agentId: owner.task!.taskId }),
        };
        model.entities.set(op.id, {
          id: op.id,
          kind: "job",
          owner: op.helper,
          task,
          card: place?.card ?? null,
          run: place?.run ?? null,
          status: "running",
        });
        const started = claude.taskStarted(w, task);
        yield* claude.call(w, {
          id: task.toolUseId,
          owner:
            owner === undefined || owner === null
              ? null
              : { helper: owner.task!.taskId, launch: owner.launch! },
          tool: "Bash",
          args: {
            command: `sleep 30 && echo ${op.id}`,
            description: NAMES.job(op.id),
            run_in_background: true,
          },
          result: `Command running in background with ID: ${task.taskId}. Output is being written to: /tmp/claude/${task.taskId}.output`,
          failed: false,
          ...(op.told === "before" ? { between: started } : {}),
        });
        if (op.told === "after") yield* started;
        break;
      }
      case "helper": {
        if (model.entities.has(op.id) || !allowedOwner(op.parent)) return false;
        const parent = ownerOf(op.parent);
        const place = placeOf(op.parent);
        const launch = `toolu_${op.id}`;
        const task: claude.TaskLinkage = {
          taskId: `a${op.id}`,
          taskType: "local_agent",
          title: NAMES.helper(op.id),
          toolUseId: launch,
          ...(parent === undefined || parent === null ? {} : { agentId: parent.task!.taskId }),
        };
        model.entities.set(op.id, {
          id: op.id,
          kind: "helper",
          owner: op.parent,
          task,
          launch,
          card: place?.card ?? null,
          run: place?.run ?? null,
          status: "running",
        });
        yield* claude.call(w, {
          id: launch,
          owner:
            parent === undefined || parent === null
              ? null
              : { helper: parent.task!.taskId, launch: parent.launch! },
          tool: "Agent",
          args: {
            description: NAMES.helper(op.id),
            prompt: `Look into ${op.id}.`,
            subagent_type: "general-purpose",
            run_in_background: true,
          },
          result: `Async agent launched successfully. agentId: ${task.taskId}`,
          failed: false,
          between: claude.taskStarted(w, task),
        });
        break;
      }
      case "progress": {
        const entity = live(op.id);
        if (entity?.task === undefined || !alive()) return false;
        yield* claude.taskProgress(w, entity.task, `Running a step of ${op.id}`);
        break;
      }
      case "end": {
        const entity = live(op.id);
        if (entity?.task === undefined || !alive()) return false;
        const summary =
          entity.kind === "job"
            ? op.how === "failed"
              ? `Background command "${entity.task.title}" failed with exit code ${op.exit}`
              : `Background command "${entity.task.title}" completed (exit code 0)`
            : `${entity.task.title}: ${op.how === "failed" ? "it failed" : "done"}.`;
        if (op.how === "failed") entity.exit = op.exit;
        ending(entity, op.how);
        yield* claude.taskNotification(w, entity.task, op.how, summary);
        break;
      }
      case "taskStop": {
        const entity = live(op.id);
        if (entity?.task === undefined || entity.kind !== "job" || entity.owner !== null)
          return false;
        if (!turnOpen()) return false;
        ending(entity, "stopped");
        yield* claude.call(w, {
          id: `toolu_stop_${op.id}`,
          owner: null,
          tool: "TaskStop",
          args: { task_id: entity.task.taskId },
          result: "Stopped.",
          failed: false,
        });
        yield* claude.taskKilled(w, entity.task);
        if (op.notified)
          yield* claude.taskNotification(w, entity.task, "stopped", "Background command stopped.");
        break;
      }
      case "finish": {
        if (!turnOpen()) return false;
        yield* w.agent((agent, thread) => agent.finish(thread));
        break;
      }
      case "wake": {
        if (!alive() || turnOpen() || active !== null || model.ended.length === 0) return false;
        const cause = model.ended.at(-1);
        if (cause === undefined) return false;
        model.wakes += 1;
        model.wakeOf = cause;
        model.ended = [];
        yield* w.agent((agent, thread) => agent.selfTurn(thread));
        break;
      }
      case "stop": {
        // The session the Stop met: gone after it (or replaced by the next message's), it took
        // its work with it.
        const before = alive() ? session() : undefined;
        yield* world.person.stop.pipe(Effect.ignore);
        if (before !== undefined && (session() !== before || !alive())) markAll("stopped");
        break;
      }
      case "reload":
        // The oracle reads a fresh client here (`checkReload`).
        break;
      case "restart": {
        markAll("lost");
        yield* world.restart;
        break;
      }
      case "crash": {
        if (!alive()) return false;
        markAll("lost");
        yield* w.agent((agent, thread) => agent.crash(thread));
        break;
      }
      case "wait":
        yield* w.advance(op.ms);
        break;
    }
    // Nothing a person or an agent does takes no time: each step lands a moment after the last, as
    // on a real clock (a whole tree at one instant orders by nothing).
    yield* w.advance(STEP_MS);
    yield* world.settle;
    yield* learnRuns(world, model);
    return true;
  });

/** Every piece of work ended, every turn finished: the tree's end as its record settles. */
export const drain = (world: OracleWorld, model: Model, rng: Rng) =>
  Effect.gen(function* () {
    const ops: Op[] = [];
    for (let round = 0; round < 40; round++) {
      const session = world.w.provider.sessions.get(world.w.thread);
      const running = [...model.entities.values()].filter(
        (entity) => entity.status === "running" && entity.kind !== "call",
      );
      // Children before their helper: a helper reports once what it started is done.
      const leaf = running.find((entity) => !running.some((child) => child.owner === entity.id));
      let op: Op;
      if (session?.alive === true && session.open !== null) op = { op: "finish" };
      else if (leaf !== undefined && session?.alive === true)
        op = { op: "end", id: leaf.id, how: rng.pick(["completed", "failed"] as const), exit: 3 };
      else if (
        model.ended.some((entity) => entity.status !== "lost") &&
        model.wakes < 3 &&
        rng.chance(0.5)
      )
        op = { op: "wake" };
      else op = { op: "wait", ms: 5_000 };
      const done = yield* play(world, model, op);
      if (done) ops.push(op);
      if (
        op.op === "wait" &&
        running.length === 0 &&
        (session?.alive !== true || session.open === null)
      ) {
        const runs = yield* runsOf(world);
        if (activeRunOf(runs) === null && !runs.some((run) => run.state !== "ended")) break;
      }
    }
    return ops;
  });

/** A random tree from a seed: up to `size` ops. */
export function generate(seed: number, size: number): Op[] {
  const rng = makeRng(seed);
  const ops: Op[] = [];
  let ids = 0;
  const next = (prefix: string) => `${prefix}${++ids}`;
  // What the tree has started that may still run, as the generator imagines it (the player
  // skips what turns out not to fit).
  const helpers: string[] = [];
  const work: string[] = [];
  const mateJobs: string[] = [];
  let open = false;
  let wakes = 0;
  ops.push({ op: "send", text: "Start the checks." });
  open = true;
  while (ops.length < size) {
    const choice = rng.weighted<Op["op"]>([
      ["say", open ? 1 : 0],
      ["call", open ? 3 : helpers.length > 0 ? 1 : 0],
      ["job", open ? 2 : helpers.length > 0 ? 1 : 0],
      ["helper", open ? 2 : helpers.length > 0 ? 0.5 : 0],
      ["progress", work.length > 0 ? 0.3 : 0],
      ["end", work.length > 0 ? 3 : 0],
      ["taskStop", open && mateJobs.length > 0 ? 0.6 : 0],
      ["finish", open ? 2 : 0],
      ["wake", !open && wakes < 3 ? 1.5 : 0],
      ["send", 0.6],
      ["steer", open ? 0.4 : 0],
      ["stop", 0.25],
      ["reload", 0.5],
      ["restart", 0.12],
      ["crash", 0.05],
      ["wait", 1],
    ]);
    const helperOrMate = () =>
      open && (helpers.length === 0 || rng.chance(0.6)) ? null : (rng.pick(helpers) ?? null);
    switch (choice) {
      case "say":
      case "finish":
      case "stop":
      case "reload":
      case "restart":
      case "crash":
        ops.push({ op: choice } as Op);
        if (choice === "finish") open = false;
        break;
      case "call":
        ops.push({ op: "call", id: next("C"), helper: helperOrMate(), fail: rng.chance(0.25) });
        break;
      case "job": {
        const id = next("J");
        const helper = helperOrMate();
        ops.push({ op: "job", id, helper, told: rng.chance(0.5) ? "before" : "after" });
        work.push(id);
        if (helper === null) mateJobs.push(id);
        break;
      }
      case "helper": {
        const id = next("H");
        ops.push({
          op: "helper",
          id,
          parent: open && rng.chance(0.7) ? null : (rng.pick(helpers) ?? null),
        });
        helpers.push(id);
        work.push(id);
        break;
      }
      case "progress":
        ops.push({ op: "progress", id: rng.pick(work) });
        break;
      case "end": {
        const id = rng.pick(work);
        ops.push({
          op: "end",
          id,
          how: rng.weighted([
            ["completed", 3],
            ["failed", 1.5],
            ["stopped", 0.5],
          ] as const),
          exit: rng.int(1, 9),
        });
        work.splice(work.indexOf(id), 1);
        if (helpers.includes(id)) helpers.splice(helpers.indexOf(id), 1);
        break;
      }
      case "taskStop": {
        const id = rng.pick(mateJobs);
        ops.push({ op: "taskStop", id, notified: rng.chance(0.5) });
        mateJobs.splice(mateJobs.indexOf(id), 1);
        if (work.includes(id)) work.splice(work.indexOf(id), 1);
        break;
      }
      case "wake":
        ops.push({ op: "wake" });
        open = true;
        wakes += 1;
        break;
      case "send":
        ops.push({ op: "send", text: `Message ${ops.length}.` });
        if (!open) open = true;
        break;
      case "steer":
        ops.push({ op: "steer", text: `Also check ${ops.length}.` });
        break;
      case "wait":
        ops.push({ op: "wait", ms: rng.int(200, 8_000) });
        break;
    }
  }
  return ops;
}

export const runOf = (n: number) => runId(mate, n) as string;
