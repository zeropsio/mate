/**
 * The engine's invariants, each traced to a rule of `docs/internals/zerops/engine.md`, checked
 * on every step against a reference model the checker folds from the events alone (never from
 * `decide`'s own state), so a rule bent in `decide` and mirrored in `evolve` still shows.
 */
import * as Schema from "effect/Schema";
import {
  EngineEvent,
  type ConversationId,
  type KnownEngineEvent,
  type RunId,
  type RunState,
} from "@t3tools/contracts";

import type { Decision, Envelope } from "../domain/command.ts";
import type { ConversationState } from "../domain/state.ts";

export class Violation extends Error {
  readonly invariant: string;
  readonly detail: string;
  constructor(invariant: string, detail: string) {
    super(`${invariant}: ${detail}`);
    this.invariant = invariant;
    this.detail = detail;
  }
}

/** Invariants a run reports but steps over, so the next broken one shows (`ENGINE_PROOF_SKIP`). */
export const skipped = new Set<string>(
  (process.env.ENGINE_PROOF_SKIP ?? "").split("|").filter((name) => name !== ""),
);

const fail = (invariant: string, detail: string): void => {
  if (skipped.has(invariant)) return;
  throw new Violation(invariant, detail);
};

/** Runs' legal moves (rule 3 and the run's states in engine.md "Terms"). */
const LEGAL: Readonly<Record<RunState | "none", ReadonlyArray<RunState>>> = {
  none: ["queued"],
  queued: ["admitted", "ended"],
  admitted: ["sending", "running", "ended"],
  sending: ["running", "ended"],
  running: ["waiting", "ended"],
  waiting: ["running", "ended"],
  ended: [],
};

/** Who may end a run, and how (rule 5: only evidence ends a run). */
const ENDERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  Stop: ["stopped/stop-asked"],
  EffectSettled: ["failed/inferred", "stopped/stop-confirmed", "stopped/stop-asked"],
  ProviderSignals: [
    "completed/agent",
    "failed/agent",
    "usage-limit/agent",
    "stopped/stop-confirmed",
    "stopped/stop-asked",
    "crashed/inferred",
  ],
  Recovered: ["cut-by-restart/inferred"],
};

interface ModelRun {
  state: RunState;
  person: string | null;
  self: boolean;
  ordinal: number;
}

/** What the checker knows, folded from events only. */
export class Model {
  readonly runs = new Map<string, ModelRun>();
  readonly queue: Array<string> = [];
  active: string | null = null;
  readonly delivery = new Map<string, string>();
  readonly effects = new Set<string>();
  readonly wakes = new Map<string, number>();
  pausedUntil: number | null = null;
  head = 0;
  nextOrdinal = 1;
  readonly log: Array<KnownEngineEvent> = [];

  readonly conversation: ConversationId;
  constructor(conversation: ConversationId) {
    this.conversation = conversation;
  }
}

const decodeEvent = Schema.decodeUnknownSync(EngineEvent);

/** Checks one step: the decision, its events against the model, and the state after it. */
export const checkStep = (input: {
  readonly model: Model;
  readonly before: ConversationState;
  readonly envelope: Envelope;
  readonly now: number;
  readonly decision: Decision;
  readonly again: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly after: ConversationState;
}): void => {
  const { model, before, envelope, now, decision, events, after } = input;
  const tag = envelope.command._tag;

  // decide is a function of (state, envelope, now): the actor and a replay must agree.
  if (JSON.stringify(decision) !== JSON.stringify(input.again)) {
    fail("decide is pure", `${tag} decided twice gave two answers`);
  }

  // Rule 2 / 7: one gapless sequence; a rejection writes nothing.
  if (decision._tag === "Reject") {
    if (events.length > 0) fail("a rejection writes nothing", `${tag} rejected with events`);
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      fail("a rejection writes nothing", `${tag} rejected but the state moved`);
    }
    return;
  }
  events.forEach((event, i) => {
    if (event.seq !== model.head + i + 1) {
      fail(
        "one gapless sequence per conversation",
        `${event._tag} got seq ${event.seq}, expected ${model.head + i + 1}`,
      );
    }
  });
  if (after.headSeq !== model.head + events.length) {
    fail(
      "one gapless sequence per conversation",
      `head ${after.headSeq} after ${events.length} events from ${model.head}`,
    );
  }
  if (decision.step.result.seq !== after.headSeq) {
    fail(
      "the result names the head after the step",
      `result seq ${decision.step.result.seq}, head ${after.headSeq}`,
    );
  }

  // Rule 4: no effect without its row — every EffectRequested has an outbox draft, and back.
  const requested = events.filter((event) => event._tag === "EffectRequested");
  const drafts = decision.step.effects;
  if (
    requested.length !== drafts.length ||
    requested.some(
      (event, i) => event.effectId !== drafts[i]!.effectId || event.kind !== drafts[i]!.kind,
    )
  ) {
    fail(
      "no effect without its row",
      `${tag}: events ${requested.map((e) => e.effectId)} vs rows ${drafts.map((d) => d.effectId)}`,
    );
  }
  for (const draft of drafts) {
    // Ids derive from their cause: `${cause}/e/${kind}/${n}`, the cause under its run.
    const match = /^(.*)\/e\/([^/]+)\/(\d+)$/.exec(draft.effectId);
    if (match === null || match[2] !== draft.kind)
      fail("ids derive from their cause", `effect id ${draft.effectId}`);
    if (draft.runId !== null && !match![1]!.startsWith(draft.runId)) {
      fail(
        "ids derive from their cause",
        `effect ${draft.effectId} is not under its run ${draft.runId}`,
      );
    }
    if (model.effects.has(draft.effectId)) {
      fail("ids derive from their cause", `effect id ${draft.effectId} asked for twice`);
    }
  }

  // Rule 10 / the store reads back what it writes: every event survives JSON and decodes.
  for (const event of events) {
    try {
      decodeEvent(JSON.parse(JSON.stringify(event)));
    } catch (error) {
      fail(
        "every event the engine writes, it can read back",
        `${event._tag}: ${String(error).slice(0, 300)}`,
      );
    }
  }

  for (const event of events) applyEvent(model, envelope, now, event);

  // Rule 3: one run at a time, and the state agrees with what the events say.
  const live = [...model.runs].filter(([, run]) => run.state !== "queued" && run.state !== "ended");
  if (live.length > 1) fail("one active run", `${live.map(([id, run]) => `${id}:${run.state}`)}`);
  if ((after.activeRunId ?? null) !== model.active) {
    fail(
      "the state agrees with the record",
      `active ${after.activeRunId} vs model ${model.active}`,
    );
  }
  if (JSON.stringify(after.queue) !== JSON.stringify(model.queue)) {
    fail("the state agrees with the record", `queue ${after.queue} vs model ${model.queue}`);
  }
  for (const [id, run] of Object.entries(after.runs)) {
    const seen = model.runs.get(id);
    if (seen === undefined || seen.state !== run.state) {
      fail(
        "the state agrees with the record",
        `run ${id} is ${run.state}, events say ${seen?.state}`,
      );
    }
  }
  // A snapshot is the state as JSON: it must carry everything the rules read.
  if (JSON.stringify(JSON.parse(JSON.stringify(after))) !== JSON.stringify(after)) {
    fail("a snapshot is the state", "the state does not survive JSON");
  }
};

const applyEvent = (model: Model, envelope: Envelope, now: number, event: KnownEngineEvent) => {
  const tag = envelope.command._tag;
  model.head = event.seq;
  model.log.push(event);
  const move = (id: string, to: RunState) => {
    const run = model.runs.get(id);
    const from = run?.state ?? "none";
    if (!LEGAL[from].includes(to))
      fail("a run moves only along its states", `${id}: ${from} → ${to} on ${tag}`);
    if (run !== undefined) run.state = to;
  };
  switch (event._tag) {
    case "RunQueued": {
      if (
        event.runId !== `${model.conversation}/r/${event.ordinal}` ||
        event.ordinal !== model.nextOrdinal
      ) {
        fail(
          "ids derive from their cause",
          `run ${event.runId} with ordinal ${event.ordinal}, next was ${model.nextOrdinal}`,
        );
      }
      model.nextOrdinal = event.ordinal + 1;
      move(event.runId, "queued");
      model.runs.set(event.runId, {
        state: "queued",
        person: event.trigger.kind === "person" ? event.trigger.itemId : null,
        self: event.trigger.kind === "wake" && event.trigger.cause === "self",
        ordinal: event.ordinal,
      });
      model.queue.push(event.runId);
      return;
    }
    case "RunAdmitted": {
      const run = model.runs.get(event.runId);
      // FIFO: only the queue's head is admitted, unless the agent itself started the turn.
      if (run !== undefined && !run.self && model.queue[0] !== event.runId) {
        fail("FIFO per conversation", `${event.runId} admitted ahead of ${model.queue[0]}`);
      }
      if (run !== undefined && !run.self && model.pausedUntil !== null && now < model.pausedUntil) {
        fail(
          "a usage limit holds the queue",
          `${event.runId} admitted at ${now}, paused until ${model.pausedUntil}`,
        );
      }
      if (model.active !== null)
        fail("one active run", `${event.runId} admitted while ${model.active} is active`);
      move(event.runId, "admitted");
      model.queue.splice(model.queue.indexOf(event.runId), 1);
      model.active = event.runId;
      return;
    }
    case "RunSending":
      return move(event.runId, "sending");
    case "RunStarted":
      return move(event.runId, "running");
    case "RunWaiting":
      return move(event.runId, "waiting");
    case "RunResumed":
      return move(event.runId, "running");
    case "RunEnded": {
      const run = model.runs.get(event.runId);
      if (run?.state === "ended")
        fail("every run ends exactly once", `${event.runId} ended twice (${tag})`);
      const how = `${event.end.kind}/${event.source}`;
      if (!(ENDERS[tag] ?? []).includes(how)) {
        fail(
          tag === "WakeFired" ? "no timer decides an outcome" : "a run ends only from evidence",
          `${tag} ended ${event.runId} as ${how}`,
        );
      }
      if (
        event.source === "agent" &&
        (event.end.kind === "completed" || event.end.kind === "failed") &&
        run !== undefined &&
        run.state !== "running" &&
        run.state !== "waiting"
      ) {
        fail(
          "the agent ends only a turn it started",
          `${event.runId} ended ${how} while ${run.state}`,
        );
      }
      move(event.runId, "ended");
      const idx = model.queue.indexOf(event.runId);
      if (idx >= 0) model.queue.splice(idx, 1);
      if (model.active === event.runId) model.active = null;
      if (event.end.kind === "usage-limit") model.pausedUntil = event.end.resetsAt;
      if (run?.person != null && model.delivery.get(run.person) === "queued") {
        fail(
          "a person's message never reads queued once its run has ended",
          `${event.runId} ended ${how} with its message still queued`,
        );
      }
      return;
    }
    case "ItemOpened":
      if (event.runId !== null && !event.itemId.startsWith(`${event.runId}/i/`)) {
        fail("ids derive from their cause", `item ${event.itemId} under run ${event.runId}`);
      }
      if (event.body.kind === "person") model.delivery.set(event.itemId, event.body.delivery.state);
      return;
    case "ItemUpdated":
    case "ItemClosed":
      if (event.body.kind === "person") model.delivery.set(event.itemId, event.body.delivery.state);
      return;
    case "RequestOpened":
      if (!event.requestId.startsWith(`${event.runId}/q/`)) {
        fail("ids derive from their cause", `request ${event.requestId} under run ${event.runId}`);
      }
      return;
    case "EffectRequested":
      model.effects.add(event.effectId);
      return;
    case "EffectOutcomeRecorded":
      if (!model.effects.has(event.effectId))
        fail("an outcome settles an effect that was asked for", event.effectId);
      return;
    case "WakeArmed": {
      if (!event.wakeId.startsWith(`${model.conversation}/w/${event.kind}/`)) {
        fail("ids derive from their cause", `wake ${event.wakeId} of kind ${event.kind}`);
      }
      model.wakes.set(event.wakeId, event.dueAt);
      return;
    }
    case "WakeFired": {
      if (!model.wakes.has(event.wakeId))
        fail("a wake fires at most once", `${event.wakeId} fired unarmed`);
      if (now < event.dueAt)
        fail("a wake fires only when due", `${event.wakeId} due ${event.dueAt} fired at ${now}`);
      model.wakes.delete(event.wakeId);
      if (model.pausedUntil !== null && event.wakeId.includes("/w/usage-resume/"))
        model.pausedUntil = null;
      return;
    }
    case "WakeCancelled":
      model.wakes.delete(event.wakeId);
      return;
    default:
      return;
  }
};

/** A timer's step never decides an outcome (rule 5): it may start work and mark, never end. */
export const checkTimerStep = (envelope: Envelope, events: ReadonlyArray<KnownEngineEvent>) => {
  if (envelope.command._tag !== "WakeFired") return;
  for (const event of events) {
    if (
      event._tag === "RunEnded" ||
      event._tag === "RequestClosed" ||
      event._tag === "EffectOutcomeRecorded"
    ) {
      fail("no timer decides an outcome", `WakeFired emitted ${event._tag}`);
    }
  }
};

export type { RunId };
