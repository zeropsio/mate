/**
 * A crew owner in a test: `decideCrew` and `evolveCrew` folded over inputs, with the engine around
 * it played by hand — effects settled, a crewmate's conversation running and ending its runs.
 *
 * @module crew/engine/crewDecideFixture
 */
import {
  CommandId,
  ConversationId,
  RunId,
  type CrewCommand,
  type CrewRunOptions,
  type KnownEngineEvent,
  type Principal,
  type RunEnd,
  type RunEndDetail,
  type WakeId,
} from "@t3tools/contracts";
import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";

import type {
  CrewDecision,
  CrewEffectDraft,
  CrewEffectValues,
  CrewInput,
  CrewToolCall,
  DeliverCommand,
} from "./command.ts";
import { deliveryCommandId } from "./command.ts";
import { decideCrew } from "./decide.ts";
import { stampCrewEvents } from "./events.ts";
import { evolveCrew } from "./evolve.ts";
import { initialCrewState, type CrewState, type TaskRecord } from "./state.ts";

export const T0 = Date.parse("2026-10-08T10:00:00.000Z");

export const PERSON: Principal = { kind: "person", subject: "user-1" };
export const OTHER: Principal = { kind: "person", subject: "user-2" };

const base = (handle: string) => ({
  handle,
  displayName: handle[0]!.toUpperCase() + handle.slice(1),
  restartAfterMerge: false,
  afterLandRestart: false,
  env: {},
  migrations: [],
  job: `${handle} owns its part.`,
});

export const writer = (handle: string, fields: Partial<CrewMemberSpec> = {}): CrewMemberSpec => ({
  ...base(handle),
  kind: "writer",
  readOnly: false,
  host: "appdev",
  check: "npm test",
  ...fields,
});

export const reader = (handle: string): CrewMemberSpec => ({
  ...base(handle),
  kind: "reader",
  readOnly: true,
});

export const lead = (handle = "lead"): CrewMemberSpec => ({
  ...base(handle),
  kind: "lead",
  readOnly: true,
});

export const home = (...members: ReadonlyArray<CrewMemberSpec>): CrewDefinition => ({
  crew: "main",
  name: "Game team",
  brief: { title: "Space shooter", text: "Build it.", doneWhen: [] },
  members,
});

export const OPTIONS: CrewRunOptions = {
  budgetUsd: "unlimited",
  timeLimitHours: "unlimited",
  stopAtUsagePercent: null,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

type Ended = {
  readonly costUsd?: number;
  readonly detail?: RunEndDetail;
  readonly refusal?: string;
};

export class CrewWorld {
  state: CrewState = initialCrewState();
  now = T0;
  last: CrewDecision | undefined;
  /** Effects asked and not settled yet, oldest first. */
  effects: Array<CrewEffectDraft> = [];
  /** Every delivery the crew asked for, oldest first. */
  delivered: Array<{ readonly handle: string | null; readonly command: DeliverCommand }> = [];
  private commands = 0;
  private log: Array<string> = [];
  private batches = new Map<string, ReadonlyArray<KnownEngineEvent>>();
  private seqs = new Map<string, number>();
  private runs = new Map<string, number>();

  tell(input: CrewInput, principal: Principal = PERSON): CrewDecision {
    this.commands += 1;
    const decision = decideCrew(
      this.state,
      { commandId: CommandId.make(`cmd-${this.commands}`), principal, input },
      this.now,
    );
    this.last = decision;
    if (decision._tag === "Accept") {
      const events = stampCrewEvents(
        this.state.headSeq,
        { conversationId: this.state.ownerId, commandId: `cmd-${this.commands}` },
        decision.step.events,
        this.now,
      );
      for (const event of events) {
        this.state = evolveCrew(this.state, event);
        this.log.push(event._tag);
      }
      for (const effect of decision.step.effects) {
        this.effects.push(effect);
        if (effect.payload.kind === "crew.deliver") {
          this.delivered.push({ handle: effect.payload.handle, command: effect.payload.command });
        }
      }
    }
    return decision;
  }

  press(press: CrewCommand, principal: Principal = PERSON, home?: CrewDefinition): CrewDecision {
    return this.tell(
      { _tag: "Press", press, door: { refusal: null }, ...(home === undefined ? {} : { home }) },
      principal,
    );
  }

  /** A task edited from the board as it stands now. */
  edit(
    number: number,
    fields: Omit<Extract<CrewCommand, { _tag: "taskEdit" }>, "_tag" | "taskId">,
    principal: Principal = PERSON,
  ): CrewDecision {
    const task = this.task(number);
    return this.tell(
      {
        _tag: "Press",
        press: { _tag: "taskEdit", taskId: task.id, ...fields },
        door: { refusal: null },
        seen: { state: task.state, attempts: task.started ? task.counters.attempt : 0 },
      },
      principal,
    );
  }

  /** A press the door refused, in admission's words. */
  refusedAtDoor(press: CrewCommand, words: string): CrewDecision {
    return this.tell({ _tag: "Press", press, door: { refusal: words } });
  }

  tool(handle: string, call: CrewToolCall): CrewDecision {
    const active = this.state.members[handle]?.active;
    return this.tell(
      { _tag: "Tool", handle, runId: active?.runId ?? null, call },
      active?.principal ?? PERSON,
    );
  }

  /** The crew home applied, every crewmate's agent and copy settled. */
  apply(definition: CrewDefinition): this {
    this.press({ _tag: "apply" }, PERSON, definition);
    this.settleAll("crew.deliver", (command) => command._tag !== "Send");
    this.settleAll("crew.lane.create", () => true, { _tag: "ready" });
    return this;
  }

  advance(ms: number): this {
    this.now += ms;
    return this;
  }

  /* ---------------------------------------------------------- effects */

  pending(kind: CrewEffectDraft["kind"], handle?: string): CrewEffectDraft | undefined {
    return this.effects.find(
      (effect) =>
        effect.kind === kind &&
        (handle === undefined ||
          ("handle" in effect.payload && effect.payload.handle === handle) ||
          ("host" in effect.payload && effect.payload.host === handle)),
    );
  }

  settle<K extends keyof CrewEffectValues>(
    kind: K,
    handle: string | undefined,
    value: CrewEffectValues[K],
  ): CrewDecision {
    const effect = this.pending(kind, handle);
    if (effect === undefined) throw new Error(`no pending ${kind} for ${handle ?? "anyone"}`);
    this.effects = this.effects.filter((other) => other !== effect);
    return this.tell(
      { _tag: "EffectSettled", effectId: effect.effectId, outcome: { kind: "ok", value } },
      { kind: "engine" },
    );
  }

  fail(kind: CrewEffectDraft["kind"], handle: string | undefined, reason: string): CrewDecision {
    const effect = this.pending(kind, handle);
    if (effect === undefined) throw new Error(`no pending ${kind} for ${handle ?? "anyone"}`);
    this.effects = this.effects.filter((other) => other !== effect);
    return this.tell(
      { _tag: "EffectSettled", effectId: effect.effectId, outcome: { kind: "failed", reason } },
      { kind: "engine" },
    );
  }

  /** Settles every pending effect of a kind (deliveries matching `which`) with `value`. */
  settleAll(
    kind: CrewEffectDraft["kind"],
    which: (command: DeliverCommand) => boolean = () => true,
    value: unknown = {},
  ): this {
    for (;;) {
      const effect = this.effects.find(
        (candidate) =>
          candidate.kind === kind &&
          (candidate.payload.kind !== "crew.deliver" || which(candidate.payload.command)),
      );
      if (effect === undefined) return this;
      this.effects = this.effects.filter((other) => other !== effect);
      this.tell(
        { _tag: "EffectSettled", effectId: effect.effectId, outcome: { kind: "ok", value } },
        { kind: "engine" },
      );
    }
  }

  /** Lets the deliveries that are not turns (agents, sessions, stops, seams) go through. */
  quiet(): this {
    return this.settleAll("crew.deliver", (command) => command._tag !== "Send");
  }

  /* ---------------------------------------------------------- conversations */

  private header(conversationId: string, commandId = "engine") {
    const seq = (this.seqs.get(conversationId) ?? 0) + 1;
    this.seqs.set(conversationId, seq);
    return {
      v: 1,
      conversationId: ConversationId.make(conversationId),
      seq,
      at: this.now,
      commandId: CommandId.make(commandId),
    };
  }

  observe(conversationId: string, events: ReadonlyArray<KnownEngineEvent>): CrewDecision {
    this.batches.set(conversationId, events);
    return this.tell(
      { _tag: "Observed", conversationId: ConversationId.make(conversationId), events },
      {
        kind: "engine",
      },
    );
  }

  /** The next turn the crew sent this crewmate is admitted and (unless `reached` is false) reaches its agent. */
  run(handle: string, reached = true): RunId {
    const member = this.state.members[handle]!;
    const entry = this.effects.find(
      (effect) =>
        effect.payload.kind === "crew.deliver" &&
        effect.payload.handle === handle &&
        effect.payload.command._tag === "Send",
    );
    if (entry === undefined) throw new Error(`no turn on its way to @${handle}`);
    this.effects = this.effects.filter((other) => other !== entry);
    const conversation = member.conversationId;
    const ordinal = (this.runs.get(conversation) ?? 0) + 1;
    this.runs.set(conversation, ordinal);
    const runId = RunId.make(`${conversation}/r/${ordinal}`);
    const command = entry.payload.kind === "crew.deliver" ? entry.payload.command : undefined;
    const principal = command?._tag === "Send" ? command.principal : PERSON;
    this.observe(conversation, [
      {
        _tag: "RunQueued",
        ...this.header(conversation, deliveryCommandId(entry.effectId)),
        runId,
        ordinal,
        trigger: { kind: "wake", cause: "crew", wakeId: null },
        joins: null,
        principal,
        maintenance: false,
        text: command?._tag === "Send" ? command.text : "",
      },
      { _tag: "RunAdmitted", ...this.header(conversation), runId },
      ...(reached
        ? [
            {
              _tag: "RunStarted",
              ...this.header(conversation),
              runId,
              providerTurnId: null,
              turn: null,
            },
          ]
        : []),
    ] as unknown as ReadonlyArray<KnownEngineEvent>);
    this.tell(
      {
        _tag: "EffectSettled",
        effectId: entry.effectId,
        outcome: { kind: "ok", value: { runId } },
      },
      { kind: "engine" },
    );
    return runId;
  }

  /** The next turn the crew sent this crewmate is refused by admission before it runs. */
  refuse(handle: string, words: string): void {
    const member = this.state.members[handle]!;
    const entry = this.effects.find(
      (effect) =>
        effect.payload.kind === "crew.deliver" &&
        effect.payload.handle === handle &&
        effect.payload.command._tag === "Send",
    )!;
    this.effects = this.effects.filter((other) => other !== entry);
    const conversation = member.conversationId;
    const ordinal = (this.runs.get(conversation) ?? 0) + 1;
    this.runs.set(conversation, ordinal);
    const runId = RunId.make(`${conversation}/r/${ordinal}`);
    this.observe(conversation, [
      {
        _tag: "RunQueued",
        ...this.header(conversation, deliveryCommandId(entry.effectId)),
        runId,
        ordinal,
        trigger: { kind: "wake", cause: "crew", wakeId: null },
        joins: null,
        principal: PERSON,
        maintenance: false,
        text: "",
      },
      {
        _tag: "RunEnded",
        ...this.header(conversation),
        runId,
        end: { kind: "failed", reason: words, next: null },
        source: "inferred-from-effect",
        detail: "refused",
        refusal: words,
      },
    ] as unknown as ReadonlyArray<KnownEngineEvent>);
  }

  /** The cursor's last batch for the crewmate's conversation, read again (a restart, a resend). */
  replay(handle: string): CrewDecision {
    const conversation = this.state.members[handle]!.conversationId;
    return this.observe(conversation, this.batches.get(conversation) ?? []);
  }

  /** The crewmate's agent opens a turn of its own, with nothing the crew sent. */
  selfRun(handle: string): RunId {
    const conversation = this.state.members[handle]!.conversationId;
    const ordinal = (this.runs.get(conversation) ?? 0) + 1;
    this.runs.set(conversation, ordinal);
    const runId = RunId.make(`${conversation}/r/${ordinal}`);
    this.observe(conversation, [
      { _tag: "RunAdmitted", ...this.header(conversation), runId },
    ] as unknown as ReadonlyArray<KnownEngineEvent>);
    return runId;
  }

  /** How many events of a tag the crew recorded over the whole journey. */
  recorded(tag: string): number {
    return this.log.filter((event) => event === tag).length;
  }

  /** The agent says something in its running turn. */
  says(handle: string, text: string): void {
    const member = this.state.members[handle]!;
    const runId = member.active!.runId;
    this.observe(member.conversationId, [
      {
        _tag: "ItemClosed",
        ...this.header(member.conversationId),
        runId,
        itemId: `${runId}/i/1`,
        body: { kind: "note", text, streaming: false, answer: true },
      },
    ] as unknown as ReadonlyArray<KnownEngineEvent>);
  }

  compacted(handle: string): void {
    const member = this.state.members[handle]!;
    this.observe(member.conversationId, [
      {
        _tag: "ItemOpened",
        ...this.header(member.conversationId),
        runId: member.active?.runId ?? null,
        itemId: `marker-${this.now}`,
        key: null,
        by: { kind: "engine" },
        body: { kind: "marker", marker: { kind: "compacted" } },
      },
    ] as unknown as ReadonlyArray<KnownEngineEvent>);
  }

  /** The crewmate's running turn ends. */
  end(handle: string, end: RunEnd = { kind: "completed" }, extra: Ended = {}): CrewDecision {
    const member = this.state.members[handle]!;
    const runId = member.active?.runId;
    if (runId === undefined) throw new Error(`@${handle} runs no turn`);
    return this.observe(member.conversationId, [
      {
        _tag: "RunEnded",
        ...this.header(member.conversationId),
        runId,
        end,
        source: "agent",
        ...extra,
      },
    ] as unknown as ReadonlyArray<KnownEngineEvent>);
  }

  /** The Mate's own conversation runs a turn, or ends it. */
  mateTurn(running: boolean): void {
    const conversation = "mate-thread";
    const runId = RunId.make(`${conversation}/r/1`);
    this.observe(
      conversation,
      (running
        ? [{ _tag: "RunAdmitted", ...this.header(conversation), runId }]
        : [
            {
              _tag: "RunEnded",
              ...this.header(conversation),
              runId,
              end: { kind: "completed" },
              source: "agent",
            },
          ]) as unknown as ReadonlyArray<KnownEngineEvent>,
    );
  }

  /** A turn's end in a writer's copy: its WIP commit made. */
  checkpoint(handle: string): CrewDecision {
    return this.settle("crew.checkpoint", handle, { _tag: "committed" });
  }

  /** A writer's whole landing chain after a done report: merged, checked, passed. */
  mergeAndCheck(handle: string): void {
    this.settle("crew.mergeIn", handle, { _tag: "merged", head: "h".repeat(40) });
    this.settle("crew.check", handle, { _tag: "passed", tail: "ok", tip: "t".repeat(40) });
  }

  /** The next queued task of a writer starts: its copy reset, its card admitted. */
  start(handle: string): RunId {
    if (this.pending("crew.lane.reset", handle) !== undefined) {
      this.settle("crew.lane.reset", handle, { _tag: "ready", resetTo: null });
    }
    return this.run(handle);
  }

  fire(kind: string, key: string): CrewDecision {
    return this.tell(
      { _tag: "WakeFired", wakeId: `${this.state.ownerId}/w/${kind}/${key}` as WakeId },
      { kind: "engine" },
    );
  }

  armed(kind: string): ReadonlyArray<{ readonly key: string; readonly dueAt: number }> {
    const prefix = `${this.state.ownerId}/w/${kind}/`;
    return Object.entries(this.state.wakes)
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, wake]) => ({ key: id.slice(prefix.length), dueAt: wake.dueAt }));
  }

  /* ---------------------------------------------------------- reads */

  task(number: number): TaskRecord {
    const task = Object.values(this.state.tasks).find((candidate) => candidate.number === number);
    if (task === undefined) throw new Error(`no #${number}`);
    return task;
  }

  /** The turns sent to a crewmate: each card's kind, or `message` for a person's own words. */
  turns(handle: string): ReadonlyArray<string> {
    return this.delivered.flatMap((entry) =>
      entry.handle === handle && entry.command._tag === "Send"
        ? [entry.command.card?.kind ?? "message"]
        : [],
    );
  }

  /** Every non-turn delivery to a crewmate, by its tag. */
  controls(handle: string): ReadonlyArray<string> {
    return this.delivered.flatMap((entry) =>
      entry.handle === handle && entry.command._tag !== "Send" ? [entry.command._tag] : [],
    );
  }

  /** The principal of the latest turn sent to a crewmate. */
  lastTurnAs(handle: string): Principal | undefined {
    const turn = this.delivered.findLast(
      (entry) => entry.handle === handle && entry.command._tag === "Send",
    );
    return turn?.command._tag === "Send" ? turn.command.principal : undefined;
  }

  rejection(): string | undefined {
    return this.last?._tag === "Reject" ? this.last.rejection.reason : undefined;
  }

  rejectionDetail(): string | null | undefined {
    return this.last?._tag === "Reject" ? this.last.rejection.detail : undefined;
  }

  reply(): { readonly text: string; readonly isError: boolean } | undefined {
    return this.last?._tag === "Accept" ? this.last.step.result.reply : undefined;
  }
}

/** A task for `handle`, created by `by`; it starts at once when its crewmate is free. */
export const newTask = (
  w: CrewWorld,
  handle: string,
  title: string,
  by: Principal = PERSON,
  dependsOn: ReadonlyArray<string> = [],
) =>
  w.press(
    { _tag: "taskCreate", owner: handle, title, brief: `${title}.`, doneWhen: "", dependsOn },
    by,
  );

/** The crewmate reports done and its turn ends: its copy saved, merged in and checked. */
export const finish = (w: CrewWorld, handle: string) => {
  w.tool(handle, { tool: "report", input: { status: "done", summary: "Done." } });
  w.end(handle);
  w.checkpoint(handle);
  w.mergeAndCheck(handle);
};

/** *Land* pressed and the landing made. */
export const landIt = (w: CrewWorld, number: number, by: Principal = PERSON) => {
  w.press({ _tag: "land", taskId: w.task(number).id }, by);
  w.settle("crew.land", w.task(number).owner, { _tag: "landed", commit: "c".repeat(40) });
};
