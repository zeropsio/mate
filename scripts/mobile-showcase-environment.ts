// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - This host-side fixture creates an isolated local T3 environment.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import {
  loadShowcaseScene,
  type ShowcaseScene as ProjectionShowcaseScene,
} from "@t3tools/shared/showcaseScenes";

import { seedShowcaseSceneInto, waitForShowcaseSeedableSchema } from "./showcase-seed.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const SHOWCASE_PROJECT_ID = "t3code";
export const SHOWCASE_THREAD_ID = "remote-command-center";
export const SHOWCASE_TERMINAL_ID = "term-1";

export const SHOWCASE_SCENES = ["threads", "thread", "terminal", "review", "environments"] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

const MODEL_SELECTION = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" } as const;
const PROJECT_SCRIPTS = [
  {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    icon: "play",
    runOnWorktreeCreate: false,
  },
  {
    id: "test",
    name: "Tests",
    command: "pnpm test",
    icon: "test",
    runOnWorktreeCreate: false,
  },
] as const;

const SHOWCASE_TERMINAL_PROMPT =
  "\u001b[1;32m→\u001b[0m \u001b[1;36mt3code\u001b[0m \u001b[1;34mgit:(\u001b[1;31mfeat/remote-command-center\u001b[1;34m)\u001b[0m \u001b[1;33m✗\u001b[0m ";

// A dev-server startup mirroring the web settings' terminal font preview:
// zsh-style prompt, brand line, addresses, the thread's 612-test summary,
// and a READY badge, so the scene exercises bold, dim, underline, the six
// accent colors, and a background cell.
export const SHOWCASE_TERMINAL_BUFFER = [
  `${SHOWCASE_TERMINAL_PROMPT}vpr dev`,
  "",
  "  \u001b[1;32mVITE\u001b[0m \u001b[32mv7.1.1\u001b[0m  \u001b[2mready in\u001b[0m \u001b[1m1.24s\u001b[0m",
  "",
  "  \u001b[32m→\u001b[0m  \u001b[2mLocal:\u001b[0m    \u001b[4;36mhttp://127.0.0.1:5173/\u001b[0m",
  "  \u001b[32m→\u001b[0m  \u001b[2mNetwork:\u001b[0m  \u001b[4;36mhttp://192.168.1.24:5173/\u001b[0m",
  "  \u001b[32m→\u001b[0m  \u001b[2mProject:\u001b[0m  \u001b[1mt3code\u001b[0m \u001b[2m— ~/Code/t3code\u001b[0m",
  "",
  "  \u001b[32m✓ 612 passed\u001b[0m   \u001b[33m△ 2 warnings\u001b[0m   \u001b[31m✗ 0 failed\u001b[0m",
  "",
  "  \u001b[42;30m READY \u001b[0m \u001b[2mwatching for changes — press\u001b[0m \u001b[1mq\u001b[0m \u001b[2mto quit\u001b[0m",
  "",
  SHOWCASE_TERMINAL_PROMPT,
].join("\r\n");

const BASE_ENVIRONMENT_PRESENCE = `export function environmentLabel(count: number): string {
  return \`${"${count}"} environments\`;
}
`;

const UPDATED_ENVIRONMENT_PRESENCE = `const PULSE = ["✦", "✧", "·", "✧"] as const;

export function environmentLabel(connected: number, total: number, frame: number): string {
  const pulse = PULSE[frame % PULSE.length];
  return \`${"${pulse} ${connected}/${total}"} ready\`;
}
`;

const REMOTE_HANDOFF_CARD = `import { View, Text } from "react-native";

export function RemoteHandoffCard(props: { machine: string; latencyMs: number }) {
  return (
    <View className="rounded-2xl bg-surface-2 p-4">
      <Text className="font-semibold">Ready on {props.machine}</Text>
      <Text className="text-success">Handoff in {props.latencyMs}ms</Text>
    </View>
  );
}
`;

const PROJECT_FAVICONS = {
  t3code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="10" fill="#000"/>
  <path d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z" fill="#fff"/>
</svg>`,
  react: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#20232a"/>
  <g fill="none" stroke="#61dafb" stroke-width="2.8"><ellipse cx="32" cy="32" rx="25" ry="9"/><ellipse cx="32" cy="32" rx="25" ry="9" transform="rotate(60 32 32)"/><ellipse cx="32" cy="32" rx="25" ry="9" transform="rotate(120 32 32)"/></g>
  <circle cx="32" cy="32" r="4.8" fill="#61dafb"/>
</svg>`,
  linux: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#f7c948"/>
  <ellipse cx="32" cy="35" rx="17" ry="22" fill="#202124"/>
  <ellipse cx="32" cy="40" rx="12" ry="14" fill="#f5f5f2"/>
  <circle cx="27" cy="24" r="5" fill="white"/><circle cx="37" cy="24" r="5" fill="white"/>
  <circle cx="28" cy="25" r="2"/><circle cx="36" cy="25" r="2"/>
  <path d="M27 31l5-4 5 4-5 4z" fill="#f28c28"/><path d="M16 55h14l-7-5zM34 55h14l-7-5z" fill="#f28c28"/>
</svg>`,
} as const;

export const SHOWCASE_PROJECTS = [
  {
    id: "t3code",
    title: "T3 Code",
    directory: "t3code",
    repositoryUrl: "https://github.com/pingdotgg/t3code.git",
    favicon: PROJECT_FAVICONS.t3code,
  },
  {
    id: "react",
    title: "React",
    directory: "react",
    repositoryUrl: "https://github.com/facebook/react.git",
    favicon: PROJECT_FAVICONS.react,
  },
  {
    id: "linux",
    title: "Linux",
    directory: "linux",
    repositoryUrl: "https://github.com/torvalds/linux.git",
    favicon: PROJECT_FAVICONS.linux,
  },
] as const;

export const SHOWCASE_ENVIRONMENTS = [
  {
    id: "moonbase-terminal",
    label: "Moonbase Terminal",
    projectIds: ["t3code"],
  },
  {
    id: "suspense-station",
    label: "Suspense Station",
    projectIds: ["react"],
  },
  {
    id: "kernel-cabin",
    label: "Kernel Cabin",
    projectIds: ["linux"],
  },
] as const;

export const SHOWCASE_THREADS = [
  {
    id: SHOWCASE_THREAD_ID,
    projectId: "t3code",
    title: "Make remote coding feel local ✦",
    branch: "feat/remote-command-center",
    minutesAgo: 3,
    request:
      "Give T3 Code a remote-first command center. Make three machines feel one tap away, keep agent work in sync, and make every handoff feel instant.",
    response:
      "T3 Code now treats every machine like it is right here in the room. ✦\n\n- Moonbase, Suspense Station, and Kernel Cabin stay live together\n- Terminal state follows you without losing a single line\n- Agent work remains perfectly in sync across devices\n- Handoffs land before your train of thought can wander\n\nI also ran the changed workspace: **612 tests passed**.",
  },
  {
    id: "pocket-command-center",
    projectId: "t3code",
    title: "Put the command center in your pocket",
    branch: "feat/pocket-command-center",
    minutesAgo: 21,
    state: "approval" as const,
    request: "Make switching between desktop, phone, and tablet feel like one continuous session.",
    response:
      "The handoff flow preserves the selected thread, terminal buffer, and working diff. The final motion treatment is ready for approval.",
  },
  {
    id: "buttery-suspense",
    projectId: "react",
    title: "Make Suspense transitions buttery",
    branch: "perf/buttery-suspense",
    minutesAgo: 12,
    state: "working" as const,
    request:
      "Trace the last few dropped frames in nested Suspense transitions and make them disappear.",
    response: null,
  },
  {
    id: "hydration-haikus",
    projectId: "react",
    title: "Turn hydration warnings into haikus",
    branch: "dev/hydration-haikus",
    minutesAgo: 44,
    request:
      "Keep hydration errors precise, but make the development copy unexpectedly delightful.",
    response:
      "The diagnostics still lead with the exact mismatch and component stack. A tiny optional haiku now closes the expanded explanation.",
    snoozeMinutes: 90,
  },
  {
    id: "beautiful-boot",
    projectId: "linux",
    title: "Make boot logs oddly beautiful",
    branch: "feat/beautiful-boot",
    minutesAgo: 34,
    state: "plan" as const,
    request:
      "Design a clearer boot timeline that remains useful over serial and never hides kernel detail.",
    response:
      "The plan groups milestones without changing the underlying log stream, preserves plain-text output, and adds zero work to the hot path.",
  },
  {
    id: "patient-penguins",
    projectId: "linux",
    title: "Teach penguins to wait patiently",
    branch: "feat/patient-penguins",
    minutesAgo: 52,
    request: "Make delayed work easier to follow without adding noise to the scheduler trace.",
    response:
      "Delayed work now carries a concise reason through the trace, so the wait is legible without changing scheduling behavior.",
    snoozeMinutes: 8 * 60,
  },
  // Finished work, settled by hand: the list keeps it as a receded tail so
  // the active block above reads as everything still in flight. The active
  // block stays small enough that the settled tail begins above the fold —
  // a store screenshot has to show that history exists, not just imply it.
  {
    id: "handoff-haptics",
    projectId: "t3code",
    title: "Tune the handoff haptics",
    branch: "feat/handoff-haptics",
    minutesAgo: 5 * 60,
    settled: true,
    request: "Give the desktop-to-phone handoff a haptic that lands with the animation.",
    response:
      "The handoff now taps once as the thread lands and stays silent on failure, so the phone never celebrates a handoff that did not happen.",
  },
  {
    id: "streaming-shell",
    projectId: "react",
    title: "Stream the shell before the data",
    branch: "feat/streaming-shell",
    minutesAgo: 28 * 60,
    settled: true,
    request: "Get the app shell painted before any data request resolves.",
    response:
      "The shell now flushes on first byte and the data boundaries hydrate underneath it, so the first paint no longer waits on the slowest query.",
  },
  {
    id: "quieter-oom",
    projectId: "linux",
    title: "Make the OOM killer explain itself",
    branch: "feat/quieter-oom",
    minutesAgo: 2 * 24 * 60,
    settled: true,
    request: "Make out-of-memory kills legible without adding a single allocation to the hot path.",
    response:
      "Kills now report the winning heuristic and the runner-up alongside the usual dump, assembled entirely from data the path already had.",
  },
] as const;

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

export function mobileShowcaseScene(
  input: {
    readonly workspaceRoots?: ReadonlyMap<string, string>;
    readonly projectIds?: ReadonlyArray<string>;
    readonly now?: number;
  } = {},
): ProjectionShowcaseScene {
  const now = input.now ?? Date.now();
  const selectedProjectIds = new Set(
    input.projectIds ?? SHOWCASE_PROJECTS.map((project) => project.id),
  );
  const projects = SHOWCASE_PROJECTS.filter((project) => selectedProjectIds.has(project.id));
  const threads = SHOWCASE_THREADS.filter((thread) => selectedProjectIds.has(thread.projectId));
  const baseScene = loadShowcaseScene("web:no-zerops");
  const workspaceRootFor = (projectId: string, directory: string) =>
    input.workspaceRoots?.get(projectId) ?? NodePath.join("/workspace", directory);

  return {
    ...baseScene,
    id: "web:mobile-showcase",
    title: "Mobile showcase",
    projects: projects.map((project, index) => {
      const projectId = ProjectId.make(project.id);
      const workspaceRoot = workspaceRootFor(project.id, project.directory);
      const latestThreadMinutes = Math.min(
        ...threads
          .filter((thread) => thread.projectId === project.id)
          .map((thread) => thread.minutesAgo),
      );
      return {
        id: projectId,
        title: project.title,
        workspaceRoot,
        defaultModelSelection: MODEL_SELECTION,
        scripts: PROJECT_SCRIPTS.map((script) => ({ ...script })),
        createdAt: minutesBefore(now, 60 * 24 * (90 - index * 12)),
        updatedAt: minutesBefore(now, latestThreadMinutes),
      };
    }),
    threads: threads.map((thread) => {
      const threadId = ThreadId.make(thread.id);
      const projectId = ProjectId.make(thread.projectId);
      const turnId = TurnId.make(`${thread.id}-turn`);
      const updatedAt = minutesBefore(now, thread.minutesAgo);
      const isWorking = "state" in thread && thread.state === "working";
      const isSettled = "settled" in thread && thread.settled;
      const snoozeMinutes = "snoozeMinutes" in thread ? thread.snoozeMinutes : undefined;
      return {
        id: threadId,
        projectId,
        title: thread.title,
        modelSelection: MODEL_SELECTION,
        runtimeMode: "full-access" as const,
        interactionMode: "state" in thread && thread.state === "plan" ? "plan" : "default",
        branch: thread.branch,
        worktreePath: workspaceRootFor(
          thread.projectId,
          SHOWCASE_PROJECTS.find((project) => project.id === thread.projectId)?.directory ??
            thread.projectId,
        ),
        latestTurn: {
          turnId,
          state: isWorking ? ("running" as const) : ("completed" as const),
          requestedAt: minutesBefore(now, thread.minutesAgo + 2),
          startedAt: minutesBefore(now, thread.minutesAgo + 2),
          completedAt: isWorking ? null : updatedAt,
          assistantMessageId: isWorking ? null : MessageId.make(`${thread.id}-answer`),
        },
        createdAt: minutesBefore(now, thread.minutesAgo + 120),
        updatedAt,
        archivedAt: null,
        settledOverride: isSettled ? ("settled" as const) : null,
        settledAt: isSettled ? updatedAt : null,
        snoozedUntil:
          snoozeMinutes === undefined ? null : new Date(now + snoozeMinutes * 60_000).toISOString(),
        snoozedAt:
          snoozeMinutes === undefined
            ? null
            : minutesBefore(now, Math.max(1, Math.floor(thread.minutesAgo / 2))),
        session: {
          threadId,
          status: isWorking ? ("running" as const) : ("ready" as const),
          providerName: "Codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access" as const,
          activeTurnId: isWorking ? turnId : null,
          lastError: null,
          updatedAt,
        },
        latestUserMessageAt: minutesBefore(now, thread.minutesAgo + 1),
        hasPendingApprovals: "state" in thread && thread.state === "approval",
        hasPendingUserInput: false,
        hasActionableProposedPlan: "state" in thread && thread.state === "plan",
      };
    }),
    threadActivities: selectedProjectIds.has(SHOWCASE_PROJECT_ID)
      ? {
          [ThreadId.make(SHOWCASE_THREAD_ID)]: [
            {
              id: EventId.make("trace-remote-handoff"),
              tone: "tool",
              kind: "tool.completed",
              summary: "Traced the remote handoff path",
              payload: {
                itemType: "command_execution",
                title: "Traced the remote handoff path",
                detail: "Three environments, one continuous workspace",
                status: "completed",
              },
              turnId: TurnId.make(`${SHOWCASE_THREAD_ID}-turn`),
              sequence: 1,
              createdAt: minutesBefore(now, 8),
            },
            {
              id: EventId.make("sync-command-center"),
              tone: "tool",
              kind: "tool.completed",
              summary: "Synced the command center",
              payload: {
                itemType: "file_change",
                title: "Synced the command center",
                detail: "2 files changed · instant handoffs · calm reconnects",
                status: "completed",
              },
              turnId: TurnId.make(`${SHOWCASE_THREAD_ID}-turn`),
              sequence: 2,
              createdAt: minutesBefore(now, 6),
            },
            {
              id: EventId.make("run-changed-suite"),
              tone: "tool",
              kind: "tool.completed",
              summary: "Ran the changed workspace",
              payload: {
                itemType: "command_execution",
                title: "Ran the changed workspace",
                detail: "612 tests passed · 3 environments online",
                status: "completed",
              },
              turnId: TurnId.make(`${SHOWCASE_THREAD_ID}-turn`),
              sequence: 3,
              createdAt: minutesBefore(now, 4),
            },
          ],
        }
      : {},
  };
}

async function runGit(workspaceRoot: string, args: ReadonlyArray<string>): Promise<void> {
  await execFile("git", [...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Alex Rivera",
      GIT_AUTHOR_EMAIL: "alex@lumen.test",
      GIT_COMMITTER_NAME: "Alex Rivera",
      GIT_COMMITTER_EMAIL: "alex@lumen.test",
    },
  });
}

async function initializeRepository(input: {
  readonly workspaceRoot: string;
  readonly repositoryUrl: string;
  readonly commitMessage: string;
}): Promise<void> {
  await runGit(input.workspaceRoot, ["init", "-b", "main"]);
  await runGit(input.workspaceRoot, ["remote", "add", "origin", input.repositoryUrl]);
  await runGit(input.workspaceRoot, ["add", "."]);
  await runGit(input.workspaceRoot, ["commit", "-m", input.commitMessage]);
}

async function seedT3CodeWorkspace(workspaceRoot: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.join(workspaceRoot, "apps/mobile/src/features/home"), {
    recursive: true,
  });
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "package.json"),
    `${JSON.stringify({ name: "t3code", private: true, scripts: { test: "vp test" } }, null, 2)}\n`,
  );
  await NodeFSP.writeFile(NodePath.join(workspaceRoot, "favicon.svg"), PROJECT_FAVICONS.t3code);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/environmentPresence.ts"),
    BASE_ENVIRONMENT_PRESENCE,
  );
  await initializeRepository({
    workspaceRoot,
    repositoryUrl: "https://github.com/pingdotgg/t3code.git",
    commitMessage: "Show connected environments",
  });
  await runGit(workspaceRoot, ["checkout", "-b", "feat/remote-command-center"]);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/environmentPresence.ts"),
    UPDATED_ENVIRONMENT_PRESENCE,
  );
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/RemoteHandoffCard.tsx"),
    REMOTE_HANDOFF_CARD,
  );
}

async function seedCompanionWorkspace(input: {
  readonly workspaceRoot: string;
  readonly title: string;
  readonly repositoryUrl: string;
  readonly favicon: string;
}): Promise<void> {
  await NodeFSP.mkdir(input.workspaceRoot, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(input.workspaceRoot, "favicon.svg"), input.favicon);
  await NodeFSP.writeFile(
    NodePath.join(input.workspaceRoot, "README.md"),
    `# ${input.title}\n\nSeeded by the T3 Code mobile screenshot harness.\n`,
  );
  await initializeRepository({
    workspaceRoot: input.workspaceRoot,
    repositoryUrl: input.repositoryUrl,
    commitMessage: `Seed ${input.title} workspace`,
  });
}

function seedMobileMessagesInto(
  database: NodeSqlite.DatabaseSync,
  threads: ReadonlyArray<(typeof SHOWCASE_THREADS)[number]>,
  now: number,
): void {
  const insertMessage = database.prepare(
    `INSERT INTO projection_thread_messages (
      message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
  );
  for (const thread of threads) {
    const turnId = `${thread.id}-turn`;
    const requestTime = minutesBefore(now, thread.minutesAgo + 5);
    insertMessage.run(
      `${thread.id}-request`,
      thread.id,
      turnId,
      "user",
      thread.request,
      requestTime,
      requestTime,
    );
    if (thread.response !== null) {
      const responseTime = minutesBefore(now, thread.minutesAgo);
      insertMessage.run(
        `${thread.id}-answer`,
        thread.id,
        turnId,
        "assistant",
        thread.response,
        responseTime,
        responseTime,
      );
    }
  }
}

export function seedMobileShowcaseDatabase(input: {
  readonly database: NodeSqlite.DatabaseSync;
  readonly scene: ProjectionShowcaseScene;
  readonly threads: ReadonlyArray<(typeof SHOWCASE_THREADS)[number]>;
  readonly now: number;
}): void {
  try {
    input.database.exec("BEGIN IMMEDIATE");
    seedShowcaseSceneInto(input.database, input.scene, input.now);
    seedMobileMessagesInto(input.database, input.threads, input.now);
    input.database.exec("COMMIT");
  } catch (error) {
    try {
      input.database.exec("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw error;
  }
}

export async function seedShowcaseEnvironment(input: {
  readonly baseDir: string;
  readonly projectIds?: ReadonlyArray<string>;
  readonly now?: number;
}): Promise<{ readonly dbPath: string; readonly workspaceRoot: string }> {
  const now = input.now ?? Date.now();
  const selectedProjectIds = new Set(
    input.projectIds ?? SHOWCASE_PROJECTS.map((project) => project.id),
  );
  const projects = SHOWCASE_PROJECTS.filter((project) => selectedProjectIds.has(project.id));
  if (projects.length === 0) throw new Error("At least one showcase project must be selected.");
  const threads = SHOWCASE_THREADS.filter((thread) => selectedProjectIds.has(thread.projectId));
  const workspaceBase = NodePath.join(input.baseDir, "workspace");
  const workspaceRoots = new Map(
    projects.map(
      (project) => [project.id, NodePath.join(workspaceBase, project.directory)] as const,
    ),
  );
  const primaryProject =
    projects.find((project) => project.id === SHOWCASE_PROJECT_ID) ?? projects[0];
  if (!primaryProject) throw new Error("The primary showcase workspace is not configured.");
  const workspaceRoot = workspaceRoots.get(primaryProject.id);
  if (!workspaceRoot) throw new Error("The primary showcase workspace is not configured.");
  const dbPath = NodePath.join(input.baseDir, "userdata", "state.sqlite");
  if (primaryProject.id === SHOWCASE_PROJECT_ID) {
    await seedT3CodeWorkspace(workspaceRoot);
  }
  await Promise.all(
    projects
      .filter((project) => project.id !== SHOWCASE_PROJECT_ID)
      .map(async (project) => {
        const projectWorkspaceRoot = workspaceRoots.get(project.id);
        if (!projectWorkspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
        await seedCompanionWorkspace({
          workspaceRoot: projectWorkspaceRoot,
          title: project.title,
          repositoryUrl: project.repositoryUrl,
          favicon: project.favicon,
        });
      }),
  );
  const scene = mobileShowcaseScene({
    workspaceRoots,
    projectIds: projects.map((project) => project.id),
    now,
  });
  await waitForShowcaseSeedableSchema(dbPath);
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30_000 });
  try {
    seedMobileShowcaseDatabase({ database, scene, threads, now });
  } finally {
    database.close();
  }

  const terminalDirectory = NodePath.join(input.baseDir, "userdata", "logs", "terminals");
  if (selectedProjectIds.has(SHOWCASE_PROJECT_ID)) {
    const safeThreadId = Buffer.from(SHOWCASE_THREAD_ID).toString("base64url");
    await NodeFSP.mkdir(terminalDirectory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(terminalDirectory, `terminal_${safeThreadId}.log`),
      SHOWCASE_TERMINAL_BUFFER,
    );
  }
  return { dbPath, workspaceRoot };
}
