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
  MessageId,
  ScopedThreadRef,
  ServerProviderSkill,
  TurnId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { AgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { createContext } from "react";

import type { ConversationSpeaker, ServerUsagePause, PauseBlock } from "./ConversationRows";
import type { DockModel } from "./conversationDock.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

export interface TimelineRowSharedState {
  /** The child measures its fold; the list owns outer scroll and row placement. Absent in standalone cards. */
  onFoldWork?: (
    input: Omit<Parameters<typeof import("./foldWork").foldWork>[0], "outer">,
  ) => () => void;
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  threadRef: ScopedThreadRef | null;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertToTurnCount: (targetTurnCount: number, messageId: MessageId) => void;
  onRunShellCommand: ((command: string) => void) | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string, fromTurnId?: TurnId) => void;
  /** Who the conversation is with: the Mate's name and colour. */
  speaker: ConversationSpeaker;
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
    readonly mate: Parameters<typeof PauseBlock>[0]["mate"];
    readonly height: number | undefined;
  };
  limit?: MateLimit;
  onUsageAutoResumeChange: ((enabled: boolean) => void) | null;
  interruption?: import("@t3tools/contracts").MateInterruption | null;
  onRestartContinue?:
    | ((interruption: import("@t3tools/contracts").MateInterruption) => void)
    | null;
  onUsageContinue?: (() => void) | null;
  /** The Mate's engine tries the provider on Continue before a known reset too. */
  usageContinueTries?: boolean;
  agentPanelModel: AgentPanelModel;
  onOpenAgents: () => void;
  /** Stops the work that outlived the turn. */
  onStopBackgroundWork: () => void;
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
  isRevertingCheckpoint: boolean;
  latestTurnId: TurnId | null;
  /** Current plan step label for the working row, when the turn has a plan. */
  workingStepLabel: string | null;
  /** A stop of the work that outlived the turn is on its way. */
  stoppingBackgroundWork: boolean;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);
export const TimelineRowActivityCtx = createContext<TimelineRowActivityState>(null!);
/** What runs now, for the Mate at work: its own context, so a pipeline stepping on re-renders that row alone. */
export const TimelineWorkingCtx = createContext<DockModel | null>(null);
