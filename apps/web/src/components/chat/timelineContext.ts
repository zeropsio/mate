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

import type { ConversationSpeaker, ServerUsagePause } from "./ConversationRows";
import type { DockModel } from "./conversationDock.logic";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

export interface TimelineRowSharedState {
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
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  /** Who the conversation is with: the Mate's name and colour. */
  speaker: ConversationSpeaker;
  /** The pause row that holds the thread now, and the server's reading of it. */
  livePauseId: string | null;
  usagePause: ServerUsagePause | null;
  onUsageAutoResumeChange: ((enabled: boolean) => void) | null;
  agentPanelModel: AgentPanelModel;
  onOpenAgents: () => void;
  /** Stops the work that outlived the turn. */
  onStopBackgroundWork: () => void;
  onSteerQueuedMessage: (id: string) => void;
  steerQueuedMessageShortcutLabel: string | null;
  onRemoveQueuedMessage: (id: string) => void;
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
