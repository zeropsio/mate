import type { MateLimit } from "@t3tools/client-runtime/data";
/**
 * What every row of the conversation reads from the list around it: shared
 * callbacks and state, through context, so they pass the list's memo
 * boundaries without re-rendering a row for one of them. `nowIso` is left out
 * on purpose — the rows that tick (`ElapsedSince`) tick on their own.
 *
 * Its own module so the run's chat (`RunChat`) and the timeline both read it
 * without importing each other.
 */
import type {
  EnvironmentId,
  ScopedThreadRef,
  ServerProviderSkill,
  TurnId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { createContext } from "react";
import type { ConversationNotice } from "./ConversationRows";

import type { ConversationSpeaker, ServerUsagePause, PauseBlock } from "./ConversationRows";
import type { DockModel } from "./conversationDock.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

export interface TimelineRowSharedState {
  /** The child measures its fold; the list owns outer scroll and row placement. Absent in standalone cards. */
  onFoldWork?: (
    input: Omit<Parameters<typeof import("./foldWork").foldWork>[0], "outer">,
  ) => () => void;
  /**
   * The answer whose words were written in a run's live slot lands: the list holds its card's
   * head where it stood, or its words' foot where their last line was read (`landingHolds`).
   * Absent in standalone cards.
   */
  onAnswerLands?: (words: HTMLElement, stood: import("./wordsLanding").WordsStood) => void;
  /**
   * A run's turn ends under the person's eyes, its last words read whole in its slot: the list
   * holds the card's head at `top` (a screen y) while the card settles. `answerApart`: nothing of
   * the slot becomes its answer — it comes with the run's end — so the view may travel to it.
   * Absent in standalone cards.
   */
  onTurnLands?: (head: HTMLElement, top: number, answerApart: boolean) => void;
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  threadRef: ScopedThreadRef | null;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  activeThreadEnvironmentId: EnvironmentId;
  onRunShellCommand: ((command: string) => void) | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  /** Takes the conversation's end row away (`ThreadEndNotice`); absent, it has no ×. */
  onDismissEndNotice?: (() => void) | undefined;
  /** Who the conversation is with: the Mate's name and colour. */
  speaker: ConversationSpeaker;
  /**
   * The conversation's agent driver (its session's `providerName`): only its own sign-in failure
   * is said as one (`mateFailureWords`).
   */
  driver?: string | null;
  /**
   * The quiet line a Mate's main conversation draws its stand-up's ask as
   * (`mateStandUpAskLine`); null where the words are just a message.
   */
  standUpAsk: string | null;
  /** The pause row that holds the thread now, and the server's reading of it. */
  livePauseId: string | null;
  usagePause: ServerUsagePause | null;
  /** The live pause occupies the measured message room; history stays in the same scroll. */
  pauseStage?: {
    /** The pause that stands as the stage (`livePauseStageId`); null when it is a notice card. */
    readonly id: string | null;
    readonly mate: Parameters<typeof PauseBlock>[0]["mate"];
    readonly height: number | undefined;
  };
  limit?: MateLimit;
  interruption?: import("@t3tools/contracts").MateInterruption | null;
  onRestartContinue?:
    | ((interruption: import("@t3tools/contracts").MateInterruption) => void)
    | null;
  onUsageContinue?: (() => void) | null;
  /** The Mate's engine tries the provider on Continue before a known reset too. */
  usageContinueTries?: boolean;
  /** Withdraws a message no agent has yet: its queued run ends, stopped by the person. */
  onWithdrawHeldMessage?: ((runId: string) => void) | null;
  agentPanelModel: AgentPanelModel;
  onOpenAgents: () => void;
  onSteerQueuedMessage: (id: string) => void;
  steerQueuedMessageShortcutLabel: string | null;
  /** A question or an approval waits on the person: the queue waits with it. */
  queueBlockedByAnswer?: boolean;
  onRemoveQueuedMessage: (id: string) => void;
  /**
   * The newest message's time when this conversation opened, on the server's
   * clock: a message after it arrived while the person watched, and rises into
   * place once. Null until the conversation has had a message.
   */
  arrivedAfter: number | null;
  /**
   * The conversation is still being read from the server: what it shows may
   * be a remembered or cached copy, and what changes meanwhile arrived before
   * the person looked, not while they watched.
   */
  syncing: boolean;
  /**
   * The person opened or closed something to read: the conversation stops
   * following its end, so the line they clicked stays where it is and only
   * what is under it moves (K12).
   */
  onHoldReading: () => void;
}

export interface TimelineRowActivityState {
  isWorking: boolean;
  isCompacting: boolean;
  /** A person's Stop is in force (`conversationStop`): the live card and the work after it say so. */
  isStopping?: boolean;
  latestTurnId: TurnId | null;
  /** Current plan step label for the working row, when the turn has a plan. */
  workingStepLabel: string | null;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);
/** What happened that still holds, by id: a notice row draws the one it names (`NoticeLine`). */
export const TimelineNoticesCtx = createContext<ReadonlyMap<string, ConversationNotice>>(new Map());
export const TimelineRowActivityCtx = createContext<TimelineRowActivityState>(null!);
/** What runs now, for the Mate at work: its own context, so a pipeline stepping on re-renders that row alone. */
export const TimelineWorkingCtx = createContext<DockModel | null>(null);
