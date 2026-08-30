// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - This host-side fixture seeds an isolated local projection.
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { ShowcaseScene } from "@t3tools/shared/showcaseScenes";

const PROJECTOR_NAMES = [
  "projection.projects",
  "projection.threads",
  "projection.thread-messages",
  "projection.thread-proposed-plans",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-turns",
  "projection.checkpoints",
  "projection.pending-approvals",
] as const;

const SEEDED_PROJECTION_TABLES = [
  "projection_pending_approvals",
  "projection_thread_proposed_plans",
  "projection_thread_activities",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_turns",
  "projection_threads",
  "projection_projects",
  "projection_state",
] as const;

const SEEDED_PROJECT_COLUMNS = ["default_thread_env_mode", "favicon_path"] as const;
const SEEDED_THREAD_COLUMNS = [
  "model_selection_json",
  "runtime_mode",
  "interaction_mode",
  "linked_pull_request_json",
  "latest_user_message_at",
  "pending_approval_count",
  "pending_user_input_count",
  "has_actionable_proposed_plan",
  "archived_at",
  "settled_override",
  "settled_at",
  "unsettled_at",
  "snoozed_until",
  "snoozed_at",
  "pinned_at",
  "pin_order_key",
  "title_regeneration_request_id",
  "title_regeneration_started_at",
] as const;

function hasSeedableSchema(dbPath: string): boolean {
  let database: NodeSqlite.DatabaseSync;
  try {
    database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return false;
  }
  try {
    const tableCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (${SEEDED_PROJECTION_TABLES.map(() => "?").join(", ")})`,
      )
      .get(...SEEDED_PROJECTION_TABLES) as { count: number };
    if (tableCount.count !== SEEDED_PROJECTION_TABLES.length) return false;

    const projectColumns = database
      .prepare("PRAGMA table_info(projection_projects)")
      .all() as Array<{
      name: string;
    }>;
    const projectColumnNames = new Set(projectColumns.map((column) => column.name));
    if (!SEEDED_PROJECT_COLUMNS.every((column) => projectColumnNames.has(column))) return false;

    const threadColumns = database.prepare("PRAGMA table_info(projection_threads)").all() as Array<{
      name: string;
    }>;
    const threadColumnNames = new Set(threadColumns.map((column) => column.name));
    return SEEDED_THREAD_COLUMNS.every((column) => threadColumnNames.has(column));
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function waitForShowcaseSeedableSchema(
  dbPath: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasSeedableSchema(dbPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The environment server did not migrate ${dbPath} within ${timeoutMs}ms.`);
}

function activityTurns(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  const turns = new Map<string, { requestedAt: string; completedAt: string }>();
  for (const activity of activities) {
    if (activity.turnId === null) continue;
    const current = turns.get(activity.turnId);
    turns.set(activity.turnId, {
      requestedAt:
        current === undefined || activity.createdAt < current.requestedAt
          ? activity.createdAt
          : current.requestedAt,
      completedAt:
        current === undefined || activity.createdAt > current.completedAt
          ? activity.createdAt
          : current.completedAt,
    });
  }
  return turns;
}

export function seedShowcaseSceneInto(
  database: NodeSqlite.DatabaseSync,
  scene: ShowcaseScene,
  now: number,
): void {
  for (const table of SEEDED_PROJECTION_TABLES) {
    database.exec(`DELETE FROM ${table}`);
  }

  const insertProject = database.prepare(
    `INSERT INTO projection_projects (
        project_id, title, workspace_root, default_model_selection_json,
        default_thread_env_mode, favicon_path, scripts_json, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  for (const project of scene.projects) {
    insertProject.run(
      project.id,
      project.title,
      project.workspaceRoot,
      project.defaultModelSelection === null ? null : JSON.stringify(project.defaultModelSelection),
      project.defaultThreadEnvMode ?? null,
      project.faviconPath ?? null,
      JSON.stringify(project.scripts),
      project.createdAt,
      project.updatedAt,
    );
  }

  const projectIds = new Set(scene.projects.map((project) => project.id));
  const insertThread = database.prepare(
    `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, linked_pull_request_json, latest_turn_id,
        latest_user_message_at, pending_approval_count, pending_user_input_count,
        has_actionable_proposed_plan, created_at, updated_at, archived_at, deleted_at,
        settled_override, settled_at, unsettled_at, snoozed_until, snoozed_at, pinned_at,
        pin_order_key, title_regeneration_request_id, title_regeneration_started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTurn = database.prepare(
    `INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state,
        requested_at, started_at, completed_at, checkpoint_turn_count, checkpoint_ref,
        checkpoint_status, checkpoint_files_json, source_proposed_plan_thread_id,
        source_proposed_plan_id
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', ?, ?)`,
  );
  const insertSession = database.prepare(
    `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
  );

  for (const thread of scene.threads) {
    if (!projectIds.has(thread.projectId)) {
      throw new Error(
        `Showcase thread ${thread.id} references missing project ${thread.projectId}.`,
      );
    }
    insertThread.run(
      thread.id,
      thread.projectId,
      thread.title,
      JSON.stringify(thread.modelSelection),
      thread.runtimeMode,
      thread.interactionMode,
      thread.branch,
      thread.worktreePath,
      thread.linkedPullRequest == null ? null : JSON.stringify(thread.linkedPullRequest),
      thread.latestTurn?.turnId ?? null,
      thread.latestUserMessageAt,
      thread.hasPendingApprovals ? 1 : 0,
      thread.hasPendingUserInput ? 1 : 0,
      thread.hasActionableProposedPlan ? 1 : 0,
      thread.createdAt,
      thread.updatedAt,
      thread.archivedAt,
      thread.settledOverride,
      thread.settledAt,
      thread.unsettledAt ?? null,
      thread.snoozedUntil ?? null,
      thread.snoozedAt ?? null,
      thread.pinnedAt ?? null,
      thread.pinOrderKey ?? null,
      thread.titleRegeneration?.requestId ?? null,
      thread.titleRegeneration?.startedAt ?? null,
    );

    const activities = scene.threadActivities[thread.id] ?? [];
    const turnsFromActivities = activityTurns(activities);
    if (thread.latestTurn !== null) {
      const latestTurn = thread.latestTurn;
      insertTurn.run(
        thread.id,
        latestTurn.turnId,
        latestTurn.assistantMessageId,
        latestTurn.state,
        latestTurn.requestedAt,
        latestTurn.startedAt,
        latestTurn.completedAt,
        latestTurn.sourceProposedPlan?.threadId ?? null,
        latestTurn.sourceProposedPlan?.planId ?? null,
      );
      turnsFromActivities.delete(latestTurn.turnId);
    }
    for (const [turnId, turn] of turnsFromActivities) {
      insertTurn.run(
        thread.id,
        turnId,
        null,
        "completed",
        turn.requestedAt,
        turn.requestedAt,
        turn.completedAt,
        null,
        null,
      );
    }

    if (thread.session !== null) {
      insertSession.run(
        thread.id,
        thread.session.status,
        thread.session.providerName,
        thread.session.providerInstanceId ?? null,
        thread.session.runtimeMode,
        thread.session.activeTurnId,
        thread.session.lastError,
        thread.session.updatedAt,
      );
    }
  }

  const insertActivity = database.prepare(
    `INSERT INTO projection_thread_activities (
        activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [threadId, activities] of Object.entries(scene.threadActivities)) {
    if (!scene.threads.some((thread) => thread.id === threadId)) {
      throw new Error(`Showcase activities reference missing thread ${threadId}.`);
    }
    for (const [index, activity] of activities.entries()) {
      insertActivity.run(
        activity.id,
        threadId,
        activity.turnId,
        activity.tone,
        activity.kind,
        activity.summary,
        JSON.stringify(activity.payload),
        activity.sequence ?? index,
        activity.createdAt,
      );
    }
  }

  const updatedAt = new Date(now - 60_000).toISOString();
  const insertProjector = database.prepare(
    "INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES (?, ?, ?)",
  );
  for (const [index, projector] of PROJECTOR_NAMES.entries()) {
    insertProjector.run(projector, index + 1, updatedAt);
  }
}

function seedDatabase(dbPath: string, scene: ShowcaseScene, now: number): void {
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30_000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    seedShowcaseSceneInto(database, scene, now);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw error;
  } finally {
    database.close();
  }
}

export async function seedShowcaseScene(input: {
  readonly baseDir: string;
  readonly scene: ShowcaseScene;
  readonly now?: number;
}): Promise<{ readonly dbPath: string }> {
  const dbPath = NodePath.join(input.baseDir, "userdata", "state.sqlite");
  await waitForShowcaseSeedableSchema(dbPath);
  seedDatabase(dbPath, input.scene, input.now ?? Date.now());
  return { dbPath };
}
