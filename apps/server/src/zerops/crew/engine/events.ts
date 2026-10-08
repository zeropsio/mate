/**
 * What the crew owner records. Each event is a fact `decide` found and `evolve` folds; the store
 * stamps the header (`v`, owner, gapless `seq`, `at`, `commandId`) as it does a conversation's.
 *
 * The engine's own wake and outcome events (`WakeArmed`, `WakeFired`, `WakeCancelled`,
 * `EffectOutcomeRecorded`) are recorded as they are, so the store's wake and effect rows follow the
 * crew as they follow a conversation. An effect the crew asks for is `EffectAsked`, which keeps what
 * it is for (its crewmate, task and attempt) so its settle can be read back.
 *
 * Changes of a record are patches whose cause the tag names (`TaskStepped` names the machine event
 * that moved the task): the fold stays one line per event, and the board's projection rows are
 * written from the same three task events.
 *
 * @module crew/engine/events
 */
import type {
  ConversationId,
  CrewSessionReason,
  CrewTaskState,
  EffectId,
  RunId,
} from "@t3tools/contracts";
import type { CrewDefinition } from "@t3tools/shared/crewHome";

import type { EventDraft } from "../../../engine/domain/command.ts";
import type { TaskCounters } from "../crewMachines.ts";
import type { RotationReason } from "../rotationDecision.ts";
import type {
  AttentionRecord,
  ClaimRecord,
  CrewTiming,
  DeliveryRecord,
  HostRecord,
  LeadRecord,
  MemberRecord,
  PendingEffect,
  RunRecord,
  TaskRecord,
} from "./state.ts";

/** What of a task an event may change besides its state. */
export type TaskPatch = Partial<
  Omit<TaskRecord, "id" | "number" | "owner" | "source" | "createdBy" | "createdAt" | "state">
>;

export type MemberPatch = Partial<Omit<MemberRecord, "handle" | "conversationId">>;

/** The engine's own events the crew owner records as a conversation does. */
export type CrewEngineEventDraft = Extract<
  EventDraft,
  { readonly _tag: "WakeArmed" | "WakeFired" | "WakeCancelled" | "EffectOutcomeRecorded" }
>;

export type CrewDomainEventDraft =
  /** A crew home applied: its definition, versions and every crewmate as they now stand. */
  | {
      readonly _tag: "CrewApplied";
      readonly definition: CrewDefinition;
      readonly briefVersion: number;
      readonly members: ReadonlyArray<MemberRecord>;
      readonly removed: ReadonlyArray<string>;
    }
  | { readonly _tag: "CrewmateUpdated"; readonly handle: string; readonly set: MemberPatch }
  /** A new session in the crewmate's one conversation, between turns. */
  | {
      readonly _tag: "SessionRotated";
      readonly handle: string;
      readonly reason: CrewSessionReason;
      readonly rotation: RotationReason | "budget";
      readonly fresh: boolean;
    }
  | { readonly _tag: "TaskCreated"; readonly task: TaskRecord }
  /** A task moved by its machine (`crewMachines.taskTransition`), `cause` the machine's event. */
  | {
      readonly _tag: "TaskStepped";
      readonly taskId: string;
      readonly cause: string;
      readonly from: CrewTaskState;
      readonly to: CrewTaskState;
      readonly counters: TaskCounters;
      readonly set: TaskPatch;
    }
  | { readonly _tag: "TaskUpdated"; readonly taskId: string; readonly set: TaskPatch }
  | { readonly _tag: "RunStarted"; readonly run: RunRecord }
  | { readonly _tag: "RunUpdated"; readonly set: Partial<Omit<RunRecord, "id">> }
  | { readonly _tag: "LeadUpdated"; readonly set: Partial<LeadRecord> }
  | { readonly _tag: "ClaimUpdated"; readonly host: string; readonly claim: ClaimRecord | null }
  | { readonly _tag: "HostUpdated"; readonly host: string; readonly set: Partial<HostRecord> }
  | { readonly _tag: "UsageRead"; readonly login: string; readonly percent: number }
  | {
      readonly _tag: "EffectAsked";
      readonly effectId: EffectId;
      readonly pending: PendingEffect;
    }
  | {
      readonly _tag: "DeliveryRecorded";
      readonly effectId: EffectId;
      readonly delivery: DeliveryRecord;
    }
  /** The run a delivery queued, from its settle or from the conversation's own record. */
  | { readonly _tag: "DeliveryLinked"; readonly effectId: EffectId; readonly runId: RunId }
  | { readonly _tag: "DeliveryClosed"; readonly effectId: EffectId }
  | {
      readonly _tag: "MateRunChanged";
      readonly conversationId: ConversationId;
      readonly runId: RunId | null;
    }
  /** The cursor over an observed conversation's log moved. */
  | { readonly _tag: "ObservedUpTo"; readonly conversationId: string; readonly seq: number }
  /** A landing the run asked for waits, in these words (said once); `null` clears it. */
  | { readonly _tag: "LandingHeld"; readonly taskId: string; readonly words: string | null }
  | { readonly _tag: "AttentionRaised"; readonly row: AttentionRecord }
  | { readonly _tag: "AttentionCleared"; readonly id: string }
  | { readonly _tag: "ErrorNoted"; readonly text: string | null }
  /** A row became due with the clock (a question, an unattended task): the snapshot moves. */
  | { readonly _tag: "Due"; readonly key: string }
  /** A crewmate's memory changed; the memory projection applies `op`. */
  | { readonly _tag: "MemoryChanged"; readonly handle: string; readonly op: unknown }
  /** The wiring set the crew's timing. */
  | { readonly _tag: "CrewConfigured"; readonly timing: CrewTiming };

export type CrewEventDraft = CrewEngineEventDraft | CrewDomainEventDraft;

export type CrewEventTag = CrewEventDraft["_tag"];

/** The header the store stamps on every event. */
export interface CrewEventHeader {
  readonly v: number;
  readonly conversationId: ConversationId;
  readonly seq: number;
  readonly at: number;
  readonly commandId: string;
}

export type CrewEvent = CrewEventDraft & CrewEventHeader;

/** The schema version every crew event this build writes carries. */
export const CREW_EVENT_VERSION = 1;

const CREW_EVENT_TAGS: ReadonlySet<string> = new Set<CrewEventTag>([
  "WakeArmed",
  "WakeFired",
  "WakeCancelled",
  "EffectOutcomeRecorded",
  "CrewApplied",
  "CrewmateUpdated",
  "SessionRotated",
  "TaskCreated",
  "TaskStepped",
  "TaskUpdated",
  "RunStarted",
  "RunUpdated",
  "LeadUpdated",
  "ClaimUpdated",
  "HostUpdated",
  "UsageRead",
  "EffectAsked",
  "DeliveryRecorded",
  "DeliveryLinked",
  "DeliveryClosed",
  "MateRunChanged",
  "ObservedUpTo",
  "LandingHeld",
  "AttentionRaised",
  "AttentionCleared",
  "ErrorNoted",
  "Due",
  "MemoryChanged",
  "CrewConfigured",
]);

/** A stored event this build knows; one from a newer build only moves the head (`evolve`). */
export const isKnownCrewEvent = (event: { readonly _tag: string }): event is CrewEvent =>
  CREW_EVENT_TAGS.has(event._tag);

/** Stamps drafts with the header the store writes: gapless seq after the head, one time. */
export const stampCrewEvents = (
  headSeq: number,
  header: { readonly conversationId: ConversationId; readonly commandId: string },
  drafts: ReadonlyArray<CrewEventDraft>,
  at: number,
): ReadonlyArray<CrewEvent> =>
  drafts.map(
    (draft, index) =>
      ({
        ...draft,
        v: CREW_EVENT_VERSION,
        conversationId: header.conversationId,
        seq: headSeq + index + 1,
        at,
        commandId: header.commandId,
      }) as CrewEvent,
  );
