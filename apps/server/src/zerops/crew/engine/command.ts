/**
 * What enters the crew owner's actor, and what `decideCrew` makes of it.
 *
 * - **A person's press** (`zerops.crew.command`), judged at the door first: the actor asks
 *   admission for the logins {@link "./decide.ts".doorLogins} names and hands its answer in, so
 *   `decide` stays pure. A press that applies or saves the crew home carries the home as parsed.
 * - **A crewmate's tool** mid-turn (`crew_report`, `crew_review`, `crew_propose`, `crew_finish`,
 *   `crew_show_on_dev`, `crew_memory`), under the run's principal; a refusal is an `isError` reply.
 * - **The engine**: a cursor's batch of an observed conversation's events, a redeploy the Mate's
 *   conversation showed, a usage gauge, a login's sign-in changing, a wake, an effect's settle,
 *   and boot.
 *
 * Every effect the crew asks for is replay-safe: its id doubles as the `Crew-Operation:` trailer a
 * handler adopts its own finished work by, and as the command id of a delivery, so the engine's
 * receipt dedupes a resend.
 *
 * @module crew/engine/command
 */
import { CommandId } from "@t3tools/contracts";
import type {
  BootId,
  ChatAttachment,
  ConversationId,
  CrewCard,
  CrewCommand,
  CrewRefusalReason,
  CrewTaskState,
  CrewServed,
  EffectId,
  EffectOutcome,
  KnownEngineEvent,
  Principal,
  RecordedCrewSeam,
  RotateSession,
  RunId,
  WakeId,
} from "@t3tools/contracts";
import type { CrewDefinition } from "@t3tools/shared/crewHome";

import type { CrewProposedTask, CrewReportInput, CrewReviewInput } from "../crewSeams.ts";
import type { CrewEventDraft } from "./events.ts";
import type { CrewTiming } from "./state.ts";

/**
 * The revision of a task a person edits from: its state and attempts as their board showed them
 * (`CrewTask.state`, `CrewTask.attempts`). An edit is refused once the task moved since.
 */
export interface TaskSeen {
  readonly state: CrewTaskState;
  readonly attempts: number;
}

/** The door's answer for the logins a press reaches: admission's words when it refused one. */
export interface DoorAnswer {
  readonly refusal: string | null;
}

export type CrewToolCall =
  | { readonly tool: "report"; readonly input: CrewReportInput }
  | { readonly tool: "review"; readonly input: CrewReviewInput }
  | { readonly tool: "propose"; readonly plan: ReadonlyArray<CrewProposedTask> }
  | { readonly tool: "finish" }
  | { readonly tool: "show-on-dev"; readonly reason: string | null }
  | { readonly tool: "memory"; readonly op: unknown };

/** A redeploy of a dev service, as the Mate's own conversation showed it. */
export type DeployPhase = "started" | "ended";

export type CrewInput =
  | {
      readonly _tag: "Press";
      readonly press: CrewCommand;
      readonly door: DoorAnswer;
      /** The crew home as parsed now, for `apply`, `briefSave` and `jobSave`. */
      readonly home?: CrewDefinition;
      /** For `taskEdit`: the task as the person's board showed it when they edited. */
      readonly seen?: TaskSeen;
    }
  | {
      readonly _tag: "Tool";
      readonly handle: string;
      readonly runId: RunId | null;
      readonly call: CrewToolCall;
    }
  /** A cursor's batch: an observed conversation's events after the crew's cursor, in order. */
  | {
      readonly _tag: "Observed";
      readonly conversationId: ConversationId;
      readonly events: ReadonlyArray<KnownEngineEvent>;
    }
  | { readonly _tag: "Deploy"; readonly host: string; readonly phase: DeployPhase }
  /** A login's fullest usage window, from its rate-limit report: a gauge, never an outcome. */
  | { readonly _tag: "Gauge"; readonly login: string; readonly usagePercent: number }
  /** These logins' sign-in or signer changed: a start admission refused may go now. */
  | { readonly _tag: "LoginsChanged"; readonly logins: ReadonlyArray<string> }
  | { readonly _tag: "WakeFired"; readonly wakeId: WakeId }
  | {
      readonly _tag: "EffectSettled";
      readonly effectId: EffectId;
      readonly outcome: EffectOutcome;
    }
  | { readonly _tag: "Recovered"; readonly bootId: BootId }
  /** The wiring's timing for the crew (tests shorten it). */
  | { readonly _tag: "Configure"; readonly timing: CrewTiming };

export interface CrewEnvelope {
  readonly commandId: CommandId;
  /** Who acts: the person pressing, a crewmate's run principal, or the engine. */
  readonly principal: Principal;
  readonly input: CrewInput;
}

/* ------------------------------------------------------------ effects */

export type CrewEffectClass = "replay-safe";

/**
 * The effects the crew asks for and the lane each queues in: a crewmate's copy (`git/<h>`), its
 * check and app (`check/<h>`), its conversation (`deliver/<h>`), a dev service (`host/<host>`).
 * Lanes run side by side; each is FIFO.
 */
export const CREW_EFFECT_KINDS = {
  "crew.deliver": "deliver",
  "crew.lane.create": "git",
  "crew.lane.reset": "git",
  "crew.lane.keep": "git",
  "crew.lane.remove": "git",
  "crew.checkpoint": "git",
  "crew.mergeIn": "git",
  "crew.check": "check",
  "crew.land": "git",
  "crew.claim.read": "host",
  "crew.app.run": "check",
  "crew.app.stop": "check",
  "crew.deploy.poll": "host",
  "crew.recover": "host",
  "crew.sweep": "git",
  "crew.host.freeze": "host",
} as const;
export type CrewEffectKind = keyof typeof CREW_EFFECT_KINDS;

export interface CrewEffectDraft {
  readonly effectId: EffectId;
  readonly kind: CrewEffectKind;
  /** `git/<handle>`, `check/<handle>`, `deliver/<handle>` or `host/<host>`. */
  readonly lane: string;
  readonly class: CrewEffectClass;
  readonly runId: null;
  readonly payload: CrewEffectPayload;
}

/** What a delivery tells a conversation, as the engine's internal API takes it. */
export type DeliverCommand =
  | {
      readonly _tag: "Send";
      /** The words the agent gets. */
      readonly text: string;
      /** The typed card the record draws in their place; absent for a person's own message. */
      readonly card: CrewCard | null;
      /** The run's principal: the person, or `crew{startedBy}`. */
      readonly principal: Principal;
      /** A person's pictures, by reference; the actor captures them before it tells the crew. */
      readonly attachments?: ReadonlyArray<ChatAttachment>;
    }
  | { readonly _tag: "Stop"; readonly runId: RunId | null }
  | (RotateSession & {
      /** The packet's makings: the crewmate and its open task, composed by the handler. */
      readonly packet: { readonly handle: string; readonly taskId: string | null };
    })
  /** The crewmate's agent: its login (instance), model and effort; the handler resolves the driver. */
  | {
      readonly _tag: "AssignAgent";
      readonly instanceId: string;
      readonly model: string | null;
      readonly effort: string | null;
      readonly profile: { readonly kind: "crewmate"; readonly id: string; readonly name: string };
    }
  | { readonly _tag: "Archive" }
  /**
   * A `crew.seam` marker on the crewmate's record: a landing, a close, a save. `words` are the
   * line's own when the decider has them (a save's); otherwise the wiring words the seam.
   */
  | { readonly _tag: "Seam"; readonly seam: RecordedCrewSeam; readonly words?: string };

/** What a crewmate's copy runs its setup, check and app with: its crew port and `env:`. */
export interface LaneEnvironment {
  readonly crewPort: number | null;
  readonly env: Readonly<Record<string, string>>;
}

/** A task as its refs name it: the engine writes its kept attempts and its landing anchor. */
export interface TaskRefs {
  /** The task's `Crew-Assignment:` key ({@link taskAssignment}). */
  readonly assignment: string;
  /** The crew run it was created in; `null` outside any. */
  readonly run: string | null;
  readonly attempt: number;
}

export type CrewEffectPayload =
  | {
      readonly kind: "crew.deliver";
      readonly conversationId: ConversationId;
      readonly handle: string | null;
      readonly command: DeliverCommand;
      /** Who the command acts for: the delivery's principal (a `Send`'s own, the presser, the engine). */
      readonly principal: Principal;
    }
  | ({
      readonly kind: "crew.lane.create";
      readonly handle: string;
      readonly host: string;
      readonly branch: string;
      readonly setup: string | null;
    } & LaneEnvironment)
  | {
      readonly kind: "crew.lane.reset";
      readonly handle: string;
      readonly taskId: string;
      readonly attempt: number;
    }
  | ({
      readonly kind: "crew.lane.keep";
      readonly handle: string;
      readonly taskId: string;
      readonly attempt: number;
    } & Omit<TaskRefs, "attempt">)
  | {
      readonly kind: "crew.lane.remove";
      readonly handle: string;
      readonly discardUnlanded: boolean;
    }
  | {
      readonly kind: "crew.checkpoint";
      readonly handle: string;
      readonly taskId: string;
      readonly attempt: number;
      /** `land-now`: the WIP commit a *Land now* lands from. */
      readonly purpose: "turn-end" | "land-now";
      readonly assignment: string;
      /** The turn's number within the attempt, for the WIP commit's subject; 0 for *Land now*. */
      readonly turn: number;
      /** The task passed its check: its copy is the tree that lands, never committed on. */
      readonly checked: boolean;
      /** Every started task: the refs the engine wrote, never blamed on the turn. */
      readonly refTasks: ReadonlyArray<TaskRefs>;
    }
  | {
      readonly kind: "crew.mergeIn";
      readonly handle: string;
      readonly taskId: string;
      readonly attempt: number;
    }
  | ({
      readonly kind: "crew.check";
      readonly handle: string;
      readonly taskId: string;
      readonly attempt: number;
      readonly command: string;
      /** Run the setup first: the merge changed the lockfile. */
      readonly setup: string | null;
      readonly host: string;
      /** The tree the check is for, as the merge left it: a copy at another tip is not checked. */
      readonly tip: string | null;
    } & LaneEnvironment)
  | {
      readonly kind: "crew.land";
      readonly handle: string;
      readonly taskId: string;
      readonly attempt: number;
      readonly title: string;
      readonly checkedTip: string | null;
      readonly assignment: string;
    }
  | {
      readonly kind: "crew.claim.read";
      readonly host: string;
      readonly handle: string;
      readonly purpose: "grant" | "after-start" | "after-release";
    }
  | ({
      readonly kind: "crew.app.run";
      readonly handle: string;
      readonly host: string;
      readonly command: string;
    } & LaneEnvironment)
  | { readonly kind: "crew.app.stop"; readonly handle: string; readonly host: string }
  | { readonly kind: "crew.deploy.poll"; readonly host: string }
  | {
      readonly kind: "crew.recover";
      readonly host: string;
      readonly handles: ReadonlyArray<string>;
      /** Each writer's copy on the host, as its setup runs again where the copy comes back. */
      readonly specs: ReadonlyArray<
        { readonly handle: string; readonly setup: string | null } & LaneEnvironment
      >;
      /** Every landing from the host's copies, which must still be in your tree. */
      readonly landings: ReadonlyArray<{ readonly assignment: string; readonly title: string }>;
    }
  | {
      readonly kind: "crew.sweep";
      readonly handle: string;
      readonly host: string;
      /** Its open task passed its check: the copy's edits are never committed. */
      readonly checked: boolean;
    }
  /** A redeploy began: the host's copies freeze until it ends, so no write lands under it. */
  | { readonly kind: "crew.host.freeze"; readonly host: string };

/* ------------------------------------------------------------ settled values */

/** Lane stats a git effect read after it ran, carried on its `ok` value. */
export interface LaneStatsValue {
  readonly ahead: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly dirty: boolean;
}

/**
 * The `ok` values `decideCrew` reads, per effect kind. A handler that could not reach a verdict
 * settles `failed`; one whose verdict is a refusal settles `ok` with the verdict's tag.
 */
export interface CrewEffectValues {
  readonly "crew.deliver": { readonly runId?: RunId };
  readonly "crew.lane.create":
    | { readonly _tag: "ready" }
    | { readonly _tag: "failed"; readonly detail: string };
  readonly "crew.lane.reset":
    | { readonly _tag: "ready"; readonly resetTo: string | null; readonly stats?: LaneStatsValue }
    | { readonly _tag: "dirty" | "frozen" | "lane-missing" | "moved" };
  readonly "crew.lane.keep":
    | { readonly _tag: "kept" }
    | { readonly _tag: "failed"; readonly detail: string };
  readonly "crew.lane.remove": { readonly _tag: "removed" } | { readonly _tag: "unlanded-commits" };
  readonly "crew.checkpoint":
    | { readonly _tag: "committed" | "unchanged"; readonly stats?: LaneStatsValue }
    /** `rework`: an open merge still carries conflict markers; nothing was committed. */
    | { readonly _tag: "edited-after-check" | "lane-missing" | "frozen" | "rework" }
    /** A guard stopped the WIP commit, or a ref moved outside the engine: the task stops. */
    | { readonly _tag: "park"; readonly detail: string };
  readonly "crew.mergeIn":
    | {
        readonly _tag: "merged" | "current";
        readonly head: string;
        /** The copy's tip after the merge: the tree its check is for. */
        readonly tip?: string;
        readonly lockfileChanged?: boolean;
        readonly stats?: LaneStatsValue;
      }
    | { readonly _tag: "conflict"; readonly head: string; readonly paths: ReadonlyArray<string> }
    | { readonly _tag: "unrelated" | "frozen" | "lane-missing" | "uncommitted" | "unknown-tip" };
  readonly "crew.check":
    | { readonly _tag: "passed"; readonly tail: string; readonly tip: string | null }
    | { readonly _tag: "failed"; readonly tail: string }
    | { readonly _tag: "timed-out" | "killed" | "lane-missing" | "setup-failed" }
    /** The copy is no longer the tree the check was asked for: nothing was checked. */
    | { readonly _tag: "moved" };
  readonly "crew.land":
    | {
        readonly _tag: "landed" | "already-landed";
        readonly commit: string;
        readonly stats?: LaneStatsValue;
      }
    | {
        readonly _tag:
          | "nothing"
          | "head-moved"
          | "not-fast-forward"
          | "index-lock"
          | "missing-object"
          | "disk-full"
          | "uncommitted"
          | "unchecked"
          | "frozen"
          | "lane-missing"
          | "unknown-tip";
      }
    | { readonly _tag: "dirty-tree" | "untracked-in-way"; readonly paths: ReadonlyArray<string> }
    | { readonly _tag: "park"; readonly detail: string };
  readonly "crew.claim.read": {
    readonly served: CrewServed;
    /** The dev service's own dev server, `null` when the Mate runs none there. */
    readonly devServer: { readonly port: number; readonly command: string } | null;
    readonly workDir: string;
  };
  readonly "crew.app.run": { readonly state: "running" | "stopped" };
  readonly "crew.app.stop": { readonly state: "running" | "stopped" };
  readonly "crew.deploy.poll": { readonly phase: "running" | "ended" | "unreadable" };
  readonly "crew.recover": {
    readonly lost: ReadonlyArray<string>;
    /** What the recovery found gone, in the crew's words: a landing, a branch, saved work. */
    readonly losses?: ReadonlyArray<string>;
  };
  readonly "crew.host.freeze": unknown;
  readonly "crew.sweep": {
    readonly swept: boolean;
    readonly stats?: LaneStatsValue;
    /** The copy as the sweep found it: its saved work, edits on a checked copy, or gone. */
    readonly copy?:
      | {
          readonly _tag: "committed";
          readonly commit: string;
          readonly paths: ReadonlyArray<string>;
        }
      | { readonly _tag: "held" | "missing" | "clean" | "merging" | "parked" | "frozen" };
  };
}

/* ------------------------------------------------------------ decisions */

/** A tool's answer to the agent: a refusal is an error the agent reads, never a rejection. */
export interface ToolReply {
  readonly text: string;
  readonly isError: boolean;
}

export interface CrewStep {
  readonly events: ReadonlyArray<CrewEventDraft>;
  readonly effects: ReadonlyArray<CrewEffectDraft>;
  readonly result: {
    readonly _tag: "Accepted";
    readonly seq: number;
    readonly reply?: ToolReply;
    /** Tasks the press created, in order. */
    readonly taskIds?: ReadonlyArray<string>;
  };
}

export interface CrewRejection {
  readonly reason: CrewRefusalReason;
  readonly detail: string | null;
}

export type CrewDecision =
  | { readonly _tag: "Accept"; readonly step: CrewStep }
  | { readonly _tag: "Reject"; readonly rejection: CrewRejection };

/* ------------------------------------------------------------ tasks in git */

/**
 * A task's key in git: its landing's `Crew-Assignment:` trailer, its attempt refs and its WIP
 * commits' subjects. The number alone repeats once a crew's state starts over, and a landing found
 * by an older task's key would read as this one's, so its creation time goes with it.
 */
export const taskAssignment = (task: { readonly id: string; readonly createdAt: number }): string =>
  `${task.id}-${task.createdAt.toString(36)}`;

/* ------------------------------------------------------------ deliveries */

const DELIVERY_PREFIX = "crew-deliver:";

/** One delivery's command id: the same for every attempt of one effect, so its receipt dedupes. */
export const deliveryCommandId = (effect: EffectId): CommandId =>
  CommandId.make(`${DELIVERY_PREFIX}${effect}`);

/** The delivery a conversation's command came from, by its command id; none for another's. */
export const deliveryOfCommand = (commandId: string): EffectId | undefined =>
  commandId.startsWith(DELIVERY_PREFIX)
    ? (commandId.slice(DELIVERY_PREFIX.length) as EffectId)
    : undefined;
