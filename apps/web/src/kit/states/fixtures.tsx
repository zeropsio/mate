/**
 * Fixture facts the state census renders its real components with: a Mate's birth at three
 * ages, an environment being created, the showcase scenes' operation cards. Static and local:
 * nothing here reads an account, a project or a Mate.
 */
import {
  deriveBirthProgress,
  type BirthFacts,
  type BirthProgress,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type {
  EnvironmentCreationStep,
  EnvironmentCreationStepProgress,
} from "@t3tools/client-runtime/zerops";
import {
  deriveZeropsThreadModel,
  type ZeropsOperation,
} from "@t3tools/client-runtime/zerops/model";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { EnvironmentId } from "@t3tools/contracts";
import { listShowcaseScenes } from "@t3tools/shared/showcaseScenes";

import type {
  TimelineRowActivityState,
  TimelineRowSharedState,
} from "~/components/chat/timelineContext";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";

export const WREN: ZeropsMateIdentity = {
  name: "Wren",
  tint: "slate",
  shape: "squircle",
  project: "Acme Docs",
  projectUrl: "https://app.zerops.io/project/kit",
  connected: false,
};

export const YOU = { initials: "AR", avatarUrl: null };

/** How far into its birth a Mate is: just pressed, its container being built, or long overdue. */
export type BirthAge = "start" | "midway" | "over-time";

const AGE_SECONDS: Readonly<Record<BirthAge, number>> = {
  start: 6,
  midway: 69,
  "over-time": 14 * 60,
};

const isoAgo = (nowMs: number, seconds: number) => new Date(nowMs - seconds * 1000).toISOString();

/** The facts a client holds `age` into a Mate's birth, read at `nowMs`. */
export function birthFacts(age: BirthAge, nowMs: number): BirthFacts {
  const seconds = AGE_SECONDS[age];
  if (age === "start") {
    return {
      project: undefined,
      container: undefined,
      processes: [],
      health: undefined,
      connection: "none",
      requestedAt: isoAgo(nowMs, seconds),
    };
  }
  return {
    project: { status: "ACTIVE", createdAt: isoAgo(nowMs, seconds) },
    container: { serviceId: "zcp", status: "CREATING", hasOrigin: false },
    processes: [
      {
        actionName: "project.create",
        status: "FINISHED",
        createdAt: isoAgo(nowMs, seconds),
        startedAt: isoAgo(nowMs, seconds),
        finishedAt: isoAgo(nowMs, seconds - 25),
        serviceIds: [],
      },
      {
        actionName: "stack.create",
        status: "RUNNING",
        createdAt: isoAgo(nowMs, seconds - 29),
        startedAt: isoAgo(nowMs, seconds - 29),
        finishedAt: null,
        serviceIds: ["zcp"],
      },
    ],
    health: undefined,
    connection: "none",
  };
}

export function birthProgress(age: BirthAge, nowMs: number): BirthProgress {
  return deriveBirthProgress(birthFacts(age, nowMs), nowMs);
}

/** A birth that stopped: its container's build failed after 70 s. */
export function failedBirthProgress(nowMs: number): BirthProgress {
  return deriveBirthProgress(
    {
      project: { status: "ACTIVE", createdAt: isoAgo(nowMs, 180) },
      container: { serviceId: "zcp", status: "ACTION_FAILED", hasOrigin: false },
      processes: [
        {
          actionName: "project.create",
          status: "FINISHED",
          serviceIds: [],
          createdAt: isoAgo(nowMs, 180),
          startedAt: isoAgo(nowMs, 180),
          finishedAt: isoAgo(nowMs, 136),
        },
        {
          actionName: "stack.create",
          status: "FAILED",
          serviceIds: ["zcp"],
          createdAt: isoAgo(nowMs, 136),
          startedAt: isoAgo(nowMs, 136),
          finishedAt: isoAgo(nowMs, 66),
          failReason: "CommandExec: init command failed",
        },
      ],
      health: undefined,
      connection: "none",
    },
    nowMs,
  );
}

const CREATION_STEPS: ReadonlyArray<EnvironmentCreationStep> = [
  { kind: "create-project", name: "Beviro CRM - production", tagList: [], location: undefined },
  { kind: "import-recipe", role: "prod", yaml: "services: []" },
  { kind: "await-ready", withAgent: false },
];

/** An environment being created, its import running for `runningSeconds`. */
export function creationProgress(
  nowMs: number,
  runningSeconds: number,
): ReadonlyArray<EnvironmentCreationStepProgress> {
  const importStart = nowMs - runningSeconds * 1000;
  return [
    {
      step: CREATION_STEPS[0]!,
      state: "done",
      startedAtMs: importStart - 4000,
      finishedAtMs: importStart,
    },
    { step: CREATION_STEPS[1]!, state: "running", startedAtMs: importStart },
    { step: CREATION_STEPS[2]!, state: "queued" },
  ];
}

/** The creation stopped at its import, with what the platform said. */
export function failedCreationProgress(): ReadonlyArray<EnvironmentCreationStepProgress> {
  return [
    { step: CREATION_STEPS[0]!, state: "done", startedAtMs: 0, finishedAtMs: 4000 },
    {
      step: CREATION_STEPS[1]!,
      state: "failed",
      startedAtMs: 4000,
      finishedAtMs: 31_000,
      error: "projectImportProjectIncluded",
    },
    { step: CREATION_STEPS[2]!, state: "queued" },
  ];
}

/** Every operation card the showcase scenes hold, as a conversation derives them. */
function showcaseOperations(): ReadonlyArray<ZeropsOperation> {
  return listShowcaseScenes().flatMap((scene) =>
    Object.values(scene.threadActivities).flatMap((activities) =>
      // Each scene's turn as the one running: a call still in flight stays running.
      deriveZeropsThreadModel({
        activities,
        runningTurnId: activities.at(-1)?.turnId ?? null,
      }).entries.flatMap((entry) => (entry.kind === "operation" ? [entry.operation] : [])),
    ),
  );
}

let operations: ReadonlyArray<ZeropsOperation> | null = null;

/** The first showcase operation in `phase`, or null where the scenes hold none. */
export function showcaseOperation(phase: ZeropsOperation["phase"]): ZeropsOperation | null {
  operations ??= showcaseOperations();
  return operations.find((operation) => operation.phase === phase) ?? null;
}

/** A conversation's row state with nothing behind it: what a run's line reads around it. */
export const ROW_SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "kit",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: "light",
  workspaceRoot: undefined,
  skills: [],
  activeThreadEnvironmentId: EnvironmentId.make("environment-kit"),
  onRevertToTurnCount: () => undefined,
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  onOpenTurnDiff: () => undefined,
  speaker: { name: WREN.name, tint: WREN.tint, shape: WREN.shape },
  standUpAsk: null,
  livePauseId: null,
  usagePause: null,
  agentPanelModel: emptyAgentPanelModel(),
  onOpenAgents: () => undefined,
  onSteerQueuedMessage: () => undefined,
  steerQueuedMessageShortcutLabel: null,
  onRemoveQueuedMessage: () => undefined,
  arrivedAfter: null,
  syncing: false,
  onHoldReading: () => undefined,
};

export const ROW_WORKING: TimelineRowActivityState = {
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  latestTurnId: null,
  workingStepLabel: null,
};
