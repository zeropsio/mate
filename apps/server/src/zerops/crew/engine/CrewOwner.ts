/**
 * The crew as an owner kind of the Mate engine: one actor per Mate (`crew/main`), its rules the
 * pure `decideCrew` and `evolveCrew`, its record the engine's log, receipt, outbox and wakes. This
 * module is the {@link crewDomain} the engine registers, and the crew's typed door over it.
 *
 * - **Engine inputs** reach the crew as they reach a conversation: an effect settled, a wake fired,
 *   the server restarted. A wake the crew no longer holds, or fired from an older arming, is
 *   refused (`wake-not-armed`), so the scheduler drops it; a settle of an effect the crew does not
 *   wait on is refused (`unknown-effect`).
 * - **Projections**, written in the step's transaction: every task (`engine_crew_task`), each
 *   crewmate's memory one operation at a time (`engine_crew_memory`) and the crew log, its newest
 *   500 entries (`engine_crew_log`).
 * - **Answers**: a step's reply to a crewmate's tool and the tasks a press created ride on its
 *   accepted result; a refusal carries the crew's own reason.
 *
 * @module crew/engine/CrewOwner
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CREW_OWNER_ID,
  CrewCommandError,
  CrewRefusalReason,
  type CommandId,
  type ConversationId,
  type Principal,
  type Rejection,
} from "@t3tools/contracts";

import type { EngineInput, Domain, OwnerDecision, OwnerEvent } from "../../../engine/owners.ts";
import type { CrewMemoryChange } from "../CrewMemory.ts";
import type { CrewInput, CrewStep, ToolReply } from "./command.ts";
import { decideCrew } from "./decide.ts";
import { isKnownCrewEvent, type CrewEvent, type CrewEventDraft } from "./events.ts";
import { evolveCrew } from "./evolve.ts";
import { initialCrewState, type CrewState, type TaskRecord } from "./state.ts";

/** What the crew owner takes: the crew's own inputs and the engine's three. */
export type CrewOwnerCommand = CrewInput | EngineInput;

/** A crew event as the engine's log holds it, its header stamped by the store. */
export type StoredCrewEvent = CrewEvent & OwnerEvent;

/** The newest crew log entries kept. */
export const CREW_LOG_KEPT = 500;

/** A task no longer on anyone's plate: its row pages as finished work. */
const FINISHED: ReadonlySet<string> = new Set(["landed", "discarded"]);

/** What an accepted crew step answers its caller, beyond the engine's head. */
export interface CrewAccepted {
  readonly seq: number;
  readonly reply?: ToolReply;
  readonly taskIds?: ReadonlyArray<string>;
}

const refusedAs = (reason: "wake-not-armed" | "unknown-effect"): OwnerDecision<never> => ({
  _tag: "Reject",
  rejection: { reason },
});

/**
 * A crew refusal as the engine's receipt holds it: the engine's reasons are its own, so a crew
 * refusal is `unknown` with the crew's reason and words in its detail, read back by
 * {@link crewRefusalOf}.
 */
const crewRejection = (reason: CrewRefusalReason, detail: string | null): Rejection => ({
  reason: "unknown",
  detail: JSON.stringify({ crew: reason, detail }),
});

const decodeRefusal = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ crew: CrewRefusalReason, detail: Schema.NullOr(Schema.String) }),
  ),
);

/** The crew's refusal back from a rejection its step recorded; another rejection is `unavailable`. */
export const crewRefusalOf = (rejection: Rejection): CrewCommandError => {
  const refusal = decodeRefusal(rejection.detail ?? "");
  return Option.isSome(refusal)
    ? new CrewCommandError({ reason: refusal.value.crew, detail: refusal.value.detail })
    : new CrewCommandError({
        reason: "unavailable",
        detail: rejection.detail ?? rejection.reason,
      });
};

const decideOwner = (
  state: CrewState,
  envelope: {
    readonly commandId: CommandId;
    readonly principal: Principal;
    readonly command: CrewOwnerCommand;
  },
  now: number,
): OwnerDecision<CrewEventDraft> => {
  const input = envelope.command;
  if (input._tag === "WakeFired") {
    const wake = state.wakes[input.wakeId];
    const armedSeq = "armedSeq" in input ? input.armedSeq : undefined;
    if (wake === undefined) return refusedAs("wake-not-armed");
    if (armedSeq !== undefined && wake.armedSeq !== undefined && armedSeq !== wake.armedSeq) {
      return refusedAs("wake-not-armed");
    }
  }
  if (input._tag === "EffectSettled" && state.effects[input.effectId] === undefined) {
    return refusedAs("unknown-effect");
  }
  const decision = decideCrew(
    state,
    { commandId: envelope.commandId, principal: envelope.principal, input: input as CrewInput },
    now,
  );
  if (decision._tag === "Reject") {
    return {
      _tag: "Reject",
      rejection: crewRejection(decision.rejection.reason, decision.rejection.detail),
    };
  }
  const step: CrewStep = decision.step;
  return {
    _tag: "Accept",
    step: {
      events: step.events,
      effects: step.effects,
      details: [],
      // The tool's reply and the press's tasks ride on the accepted result to the caller.
      result: step.result as unknown as { readonly _tag: "Accepted"; readonly seq: number },
    },
  };
};

/* ------------------------------------------------------------ projections */

const json = (value: unknown): string => JSON.stringify(value);

const putTask = (owner: ConversationId, task: TaskRecord, at: number) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql`
      INSERT INTO engine_crew_task (
        owner_id, task_id, number, handle, state, finished, updated_at, task_json
      ) VALUES (
        ${owner}, ${task.id}, ${task.number}, ${task.owner}, ${task.state},
        ${FINISHED.has(task.state) ? 1 : 0}, ${at}, ${json(task)}
      )
      ON CONFLICT (owner_id, task_id) DO UPDATE SET number = excluded.number,
        handle = excluded.handle, state = excluded.state, finished = excluded.finished,
        updated_at = excluded.updated_at, task_json = excluded.task_json
    `.pipe(Effect.asVoid),
  );

const appendLog = (owner: ConversationId, event: CrewEvent, kind: string, payload: unknown) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO engine_crew_log (owner_id, seq, at, kind, payload_json)
        VALUES (${owner}, ${event.seq}, ${event.at}, ${kind}, ${json(payload)})
        ON CONFLICT DO NOTHING
      `;
      yield* sql`
        DELETE FROM engine_crew_log WHERE owner_id = ${owner} AND seq < (
          SELECT seq FROM engine_crew_log WHERE owner_id = ${owner}
          ORDER BY seq DESC LIMIT 1 OFFSET ${CREW_LOG_KEPT - 1}
        )
      `;
    }),
  );

const memoryChange = (owner: ConversationId, handle: string, change: CrewMemoryChange) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => {
    switch (change.kind) {
      case "put": {
        const entry = change.entry;
        return sql`
          INSERT INTO engine_crew_memory (
            owner_id, handle, entry_id, kind, topic, text, paths_json, verified_at,
            from_assignment, updated_at
          ) VALUES (
            ${owner}, ${handle}, ${entry.id}, ${entry.kind}, ${entry.topic}, ${entry.text},
            ${json(entry.paths)}, ${entry.verifiedAt}, ${entry.fromAssignment}, ${entry.updatedAt}
          )
          ON CONFLICT (owner_id, handle, entry_id) DO UPDATE SET kind = excluded.kind,
            topic = excluded.topic, text = excluded.text, paths_json = excluded.paths_json,
            verified_at = excluded.verified_at, from_assignment = excluded.from_assignment,
            updated_at = excluded.updated_at
        `.pipe(Effect.asVoid);
      }
      case "delete":
        return sql`
          DELETE FROM engine_crew_memory
          WHERE owner_id = ${owner} AND handle = ${handle} AND entry_id = ${change.id}
        `.pipe(Effect.asVoid);
      case "none":
        return Effect.void;
    }
  });

const isMemoryChange = (op: unknown): op is CrewMemoryChange =>
  typeof op === "object" &&
  op !== null &&
  "kind" in op &&
  (op.kind === "put" || op.kind === "delete" || op.kind === "none");

const projectCrew = (event: CrewEvent, state: CrewState) => {
  const owner = state.ownerId;
  switch (event._tag) {
    case "TaskCreated":
    case "TaskUpdated": {
      const task = state.tasks[event._tag === "TaskCreated" ? event.task.id : event.taskId];
      return task === undefined ? Effect.void : putTask(owner, task, event.at);
    }
    case "TaskStepped": {
      const task = state.tasks[event.taskId];
      if (task === undefined) return Effect.void;
      return putTask(owner, task, event.at).pipe(
        Effect.andThen(() => {
          if (event.to === "landed" && event.from !== "landed") {
            return task.landedCommit === null
              ? appendLog(owner, event, "closed", { task: task.id, reason: "nothing to land" })
              : appendLog(owner, event, "landed", { task: task.id, commit: task.landedCommit });
          }
          if (event.to === "parked" && event.from !== "parked") {
            return appendLog(owner, event, "parked", {
              task: task.id,
              reason: task.wait?.reason ?? null,
            });
          }
          return Effect.void;
        }),
      );
    }
    case "LandingHeld":
      return event.words === null
        ? Effect.void
        : appendLog(owner, event, "landing-held", { task: event.taskId, detail: event.words });
    case "RunStarted":
      return appendLog(owner, event, `run-${event.run.state}`, {
        reason: event.run.reason,
        detail: event.run.reasonDetail,
      });
    case "RunUpdated":
      return event.set.state === undefined
        ? Effect.void
        : appendLog(owner, event, `run-${event.set.state}`, {
            reason: state.run?.reason ?? null,
            detail: state.run?.reasonDetail ?? null,
          });
    case "MemoryChanged":
      return isMemoryChange(event.op) ? memoryChange(owner, event.handle, event.op) : Effect.void;
    default:
      return Effect.void;
  }
};

/** The crew, as the engine hosts it. */
export const crewDomain: Domain<CrewState, CrewOwnerCommand, StoredCrewEvent, CrewEventDraft> = {
  kind: "crew",
  owns: (owner) => owner.startsWith("crew/"),
  stateVersion: 1,
  initial: (owner) => initialCrewState(owner),
  decide: decideOwner,
  evolve: (state, event) => evolveCrew(state, event),
  // Crew events are the crew's own JSON: read back as written. One a newer build wrote only moves
  // the head (`evolveCrew`).
  decode: (row) => Effect.succeed(row as unknown as StoredCrewEvent),
  encode: (event) => Effect.succeed(event),
  project: (event, state) =>
    isKnownCrewEvent(event) ? projectCrew(event, state).pipe(Effect.asVoid) : Effect.void,
  rowAgent: () => null,
  runOf: () => null,
};

export { CREW_OWNER_ID };
