import {
  ChatAttachment,
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ThreadCrewOrigin,
  ThreadId,
  ThreadUsagePauseState,
  TurnId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT, USAGE_LIMIT_RESUME_PROMPT } from "@t3tools/shared/userAsk";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import * as ThreadLiveStep from "../ThreadLiveStep.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { encodeThreadDetailPageCursor } from "../threadDetailCursor.ts";
import { projectThreadDetailSnapshot } from "../ActivityPayloadProjection.ts";
import { activityBudgetColumns } from "../../persistence/activityBudgetColumns.ts";
import { makeSqlStatementCounter } from "../../../integration/SqlStatementCounter.integration.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.make(value);
const encodeChatAttachments = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(ChatAttachment)),
);
const encodeUsagePause = Schema.encodeEffect(Schema.fromJsonString(ThreadUsagePauseState));
const encodeCrewOrigin = Schema.encodeEffect(Schema.fromJsonString(ThreadCrewOrigin));
const encodeActivityPayload = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeActivityPayload = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
// The columns the activity repository writes beside a payload, for rows a
// test stores itself (`fillBudgetColumns` for rows stored by SQL).
const budgetColumnsOf = (kind: string, payload: unknown) => {
  const columns = activityBudgetColumns(kind, payload);
  return {
    agent_id: columns.agentId,
    call_id: columns.callId,
    task_id: columns.taskId,
    used_tokens: columns.usedTokens,
  };
};

const projectionSnapshotLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(ThreadLiveStep.layer),
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

projectionSnapshotLayer("ProjectionSnapshotQuery", (it) => {
  it.effect("hydrates read model from projection tables and computes snapshot sequence", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          linked_pull_request_json,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          pinned_at,
          pin_order_key,
          active_order_key,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          '{"projectId":"project-1","repository":"pingdotgg/t3code","number":42,"url":"https://github.com/pingdotgg/t3code/pull/42"}',
          'turn-1',
          '2026-02-24T00:00:04.000Z',
          1,
          0,
          0,
          '2026-02-24T00:00:01.000Z',
          'gm',
          'hq',
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          'message-1',
          'thread-1',
          'turn-1',
          'assistant',
          'hello from projection',
          0,
          '2026-02-24T00:00:04.000Z',
          '2026-02-24T00:00:05.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id,
          thread_id,
          turn_id,
          plan_markdown,
          implemented_at,
          implementation_thread_id,
          created_at,
          updated_at
        )
        VALUES (
          'plan-1',
          'thread-1',
          'turn-1',
          '# Ship it',
          '2026-02-24T00:00:05.500Z',
          'thread-2',
          '2026-02-24T00:00:05.000Z',
          '2026-02-24T00:00:05.500Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          created_at
        )
        VALUES (
          'activity-1',
          'thread-1',
          'turn-1',
          'info',
          'runtime.note',
          'provider started',
          '{"stage":"start"}',
          '2026-02-24T00:00:06.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          'thread-1',
          'running',
          'codex',
          'provider-session-1',
          'provider-thread-1',
          'approval-required',
          'turn-1',
          NULL,
          '2026-02-24T00:00:07.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-1',
          'turn-1',
          NULL,
          'thread-1',
          'plan-1',
          'message-1',
          'completed',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          1,
          'checkpoint-1',
          'ready',
          '[{"path":"README.md","kind":"modified","additions":2,"deletions":1}]'
        )
      `;

      let sequence = 5;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-02-24T00:00:09.000Z'
          )
        `;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 5);
      assert.equal(snapshot.updatedAt, "2026-02-24T00:00:09.000Z");
      assert.deepEqual(snapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          repositoryIdentity: null,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          faviconPath: null,
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          defaultThreadEnvMode: null,
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
          deletedAt: null,
        },
      ]);
      assert.deepEqual(snapshot.threads, [
        {
          id: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          linkedPullRequest: {
            projectId: asProjectId("project-1"),
            repository: "pingdotgg/t3code",
            number: 42,
            url: "https://github.com/pingdotgg/t3code/pull/42",
          },
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
            sourceProposedPlan: {
              threadId: ThreadId.make("thread-1"),
              planId: "plan-1",
            },
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          unsettledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: "2026-02-24T00:00:01.000Z",
          pinOrderKey: "gm",
          activeOrderKey: "hq",
          autoSettleDisabledAt: null,
          titleRegeneration: null,
          titleState: null,
          deletedAt: null,
          messages: [
            {
              id: asMessageId("message-1"),
              role: "assistant",
              text: "hello from projection",
              turnId: asTurnId("turn-1"),
              streaming: false,
              createdAt: "2026-02-24T00:00:04.000Z",
              updatedAt: "2026-02-24T00:00:05.000Z",
            },
          ],
          proposedPlans: [
            {
              id: "plan-1",
              turnId: asTurnId("turn-1"),
              planMarkdown: "# Ship it",
              implementedAt: "2026-02-24T00:00:05.500Z",
              implementationThreadId: ThreadId.make("thread-2"),
              createdAt: "2026-02-24T00:00:05.000Z",
              updatedAt: "2026-02-24T00:00:05.500Z",
            },
          ],
          activities: [
            {
              id: asEventId("activity-1"),
              tone: "info",
              kind: "runtime.note",
              summary: "provider started",
              payload: { stage: "start" },
              turnId: asTurnId("turn-1"),
              createdAt: "2026-02-24T00:00:06.000Z",
            },
          ],
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-1"),
              status: "ready",
              files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
              assistantMessageId: asMessageId("message-1"),
              completedAt: "2026-02-24T00:00:08.000Z",
            },
          ],
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            interruption: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
        },
      ]);

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.snapshotSequence, 5);
      assert.deepEqual(shellSnapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          repositoryIdentity: null,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          faviconPath: null,
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          defaultThreadEnvMode: null,
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
        },
      ]);
      assert.deepEqual(shellSnapshot.threads, [
        {
          id: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          linkedPullRequest: {
            projectId: asProjectId("project-1"),
            repository: "pingdotgg/t3code",
            number: 42,
            url: "https://github.com/pingdotgg/t3code/pull/42",
          },
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
            sourceProposedPlan: {
              threadId: ThreadId.make("thread-1"),
              planId: "plan-1",
            },
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          unsettledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: "2026-02-24T00:00:01.000Z",
          pinOrderKey: "gm",
          activeOrderKey: "hq",
          autoSettleDisabledAt: null,
          titleRegeneration: null,
          titleState: null,
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            interruption: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
          latestUserMessageAt: "2026-02-24T00:00:04.000Z",
          hasPendingApprovals: true,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
          backgroundLiveness: null,
          backgroundTaskIds: [],
          planProgress: null,
          usagePause: null,
        },
      ]);

      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));
      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.deepEqual(threadDetail.value, snapshot.threads[0]);
      }

      const commandSnapshot = yield* snapshotQuery.getCommandReadModel();
      assert.equal(commandSnapshot.threads[0]?.activeOrderKey, "hq");

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          created_at
        )
        VALUES
          (
            'activity-task-started',
            'thread-1',
            'turn-1',
            'info',
            'task.started',
            'Ship the query filter',
            '{"taskId":"task-1","detail":"Ship the query filter"}',
            '2026-02-24T00:00:06.100Z'
          ),
          (
            'activity-malformed-tool',
            'thread-1',
            'turn-1',
            'info',
            'tool.completed',
            'Malformed tool output',
            'not-json',
            '2026-02-24T00:00:06.200Z'
          )
      `;

      const detailWithoutActivities = yield* snapshotQuery.getThreadDetailById(
        ThreadId.make("thread-1"),
        { activityKinds: [] },
      );
      assert.equal(detailWithoutActivities._tag, "Some");
      if (detailWithoutActivities._tag === "Some") {
        assert.equal(detailWithoutActivities.value.activeOrderKey, "hq");
        assert.deepEqual(detailWithoutActivities.value.activities, []);
        assert.deepEqual(detailWithoutActivities.value.messages, snapshot.threads[0]?.messages);
        assert.deepEqual(
          detailWithoutActivities.value.proposedPlans,
          snapshot.threads[0]?.proposedPlans,
        );
        assert.deepEqual(
          detailWithoutActivities.value.checkpoints,
          snapshot.threads[0]?.checkpoints,
        );
      }

      const detailWithTaskActivities = yield* snapshotQuery.getThreadDetailById(
        ThreadId.make("thread-1"),
        { activityKinds: ["task.started", "task.progress"] },
      );
      assert.equal(detailWithTaskActivities._tag, "Some");
      if (detailWithTaskActivities._tag === "Some") {
        assert.deepEqual(detailWithTaskActivities.value.activities, [
          {
            id: asEventId("activity-task-started"),
            tone: "info",
            kind: "task.started",
            summary: "Ship the query filter",
            payload: { taskId: "task-1", detail: "Ship the query filter" },
            turnId: asTurnId("turn-1"),
            createdAt: "2026-02-24T00:00:06.100Z",
          },
        ]);
      }

      const counter = makeSqlStatementCounter();
      const context = yield* snapshotQuery
        .getThreadRuntimeContext(ThreadId.make("thread-1"))
        .pipe(Effect.withTracer(counter.tracer));
      assert.equal(counter.count(), 1);
      assert.equal(context._tag, "Some");
      if (context._tag === "Some") {
        assert.deepEqual(context.value, {
          id: ThreadId.make("thread-1"),
          title: "Thread 1",
          titleState: null,
          session: snapshot.threads[0]?.session ?? null,
        });
      }

      yield* sql`
        UPDATE projection_thread_sessions
        SET status = 'starting', active_turn_id = NULL, provider_name = 'claudeAgent',
            provider_instance_id = 'claude-secondary', last_error = 'Starting another session'
        WHERE thread_id = 'thread-1'
      `;
      const changedContext = yield* snapshotQuery.getThreadRuntimeContext(
        ThreadId.make("thread-1"),
      );
      assert.equal(changedContext._tag, "Some");
      if (changedContext._tag === "Some") {
        assert.equal(changedContext.value.session?.status, "starting");
        assert.equal(changedContext.value.session?.activeTurnId, null);
        assert.equal(changedContext.value.session?.providerName, "claudeAgent");
        assert.equal(changedContext.value.session?.providerInstanceId, "claude-secondary");
        assert.equal(changedContext.value.session?.lastError, "Starting another session");
      }
    }),
  );

  it.effect("reads one turn-start message without decoding unrelated history", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-turn-start-read");
      const messageId = MessageId.make("message-turn-start-read");
      const createdAt = "2026-09-05T00:00:00.000Z";
      const attachments = [
        {
          type: "file" as const,
          id: "notes",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 8,
        },
      ];
      const attachmentsJson = yield* encodeChatAttachments(attachments);
      yield* sql`
        WITH RECURSIVE history(n) AS (
          VALUES (1) UNION ALL SELECT n + 1 FROM history WHERE n < 2000
        )
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, attachments_json,
          is_streaming, created_at, updated_at
        )
        SELECT 'turn-start-history:' || n, ${threadId}, 'old-turn:' || n, 'assistant',
          'Unrelated assistant output', 'not-json', 0, ${createdAt}, ${createdAt}
        FROM history
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, role, text, attachments_json, is_streaming, created_at, updated_at
        ) VALUES (${messageId}, ${threadId}, 'user', 'Read these notes',
          ${attachmentsJson}, 0, ${createdAt}, ${createdAt})
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, role, text, attachments_json, is_streaming, created_at, updated_at
        ) VALUES ('turn-start-unrelated-user', 'thread-turn-start-unrelated', 'user', 'Unrelated prompt',
          'not-json', 0, ${createdAt}, ${createdAt})
      `;

      const counter = makeSqlStatementCounter();
      const context = yield* query
        .getTurnStartMessage({ threadId, messageId })
        .pipe(Effect.withTracer(counter.tracer));
      assert.equal(counter.count(), 1);
      assert.deepEqual(
        context,
        Option.some({
          message: {
            id: messageId,
            role: "user",
            text: "Read these notes",
            turnId: null,
            streaming: false,
            createdAt,
            updatedAt: createdAt,
            attachments,
          },
          hasOtherAsks: false,
        }),
      );
      assert.equal(
        (yield* query.getTurnStartMessage({
          threadId: ThreadId.make("thread-turn-start-unrelated"),
          messageId,
        }))._tag,
        "None",
      );
      assert.equal(
        (yield* query.getTurnStartMessage({ threadId, messageId: MessageId.make("missing") }))._tag,
        "None",
      );
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            DELETE FROM projection_thread_messages
            WHERE thread_id IN ('thread-turn-start-read', 'thread-turn-start-unrelated')
          `;
        }).pipe(Effect.orDie),
      ),
    ),
  );

  // Only an ask titles a thread: slash commands and the server's resume prompt
  // are not one, attachments without words are (@t3tools/shared/userAsk).
  it.effect("counts only other asks, queued ones included, in the turn-start query", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-turn-start-eligibility");
      const messageId = MessageId.make("message-turn-start-eligibility");
      const createdAt = "2026-09-05T00:00:00.000Z";
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, role, text, is_streaming, created_at, updated_at
        ) VALUES (${messageId}, ${threadId}, 'user', 'Start a turn', 0, ${createdAt}, ${createdAt})
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, role, text, attachments_json, is_streaming, created_at, updated_at
        ) VALUES ('turn-start-other-user', ${threadId}, 'user', '/compact', NULL, 0,
          '2026-09-05T00:00:01.000Z', '2026-09-05T00:00:01.000Z')
      `;

      const notes =
        '[{"type":"file","id":"notes","name":"notes.txt","mimeType":"text/plain","sizeBytes":8}]';
      const screenshot =
        '[{"type":"image","id":"shot","name":"shot.png","mimeType":"image/png","sizeBytes":8}]';
      for (const { text, attachments, hasOtherAsks } of [
        { text: "/compact", attachments: null, hasOtherAsks: false },
        { text: "\t\n\r /CoMpAcT\u00a0\u2028\ufeff", attachments: "[ ]", hasOtherAsks: false },
        { text: "/compact keep recent errors", attachments: "[]", hasOtherAsks: false },
        { text: "/model opus", attachments: null, hasOtherAsks: false },
        { text: "/compact", attachments: notes, hasOtherAsks: false },
        { text: USAGE_LIMIT_RESUME_PROMPT, attachments: null, hasOtherAsks: false },
        { text: "", attachments: null, hasOtherAsks: false },
        { text: "Queued prompt", attachments: null, hasOtherAsks: true },
        { text: "/var/www/app fails to build", attachments: null, hasOtherAsks: true },
        { text: IMAGE_ONLY_BOOTSTRAP_PROMPT, attachments: screenshot, hasOtherAsks: true },
        { text: "", attachments: notes, hasOtherAsks: true },
      ]) {
        yield* sql`
          UPDATE projection_thread_messages SET text = ${text}, attachments_json = ${attachments}
          WHERE message_id = 'turn-start-other-user'
        `;
        const context = yield* query.getTurnStartMessage({ threadId, messageId });
        assert.equal(context._tag, "Some");
        if (context._tag === "Some") {
          assert.equal(context.value.hasOtherAsks, hasOtherAsks, `other message "${text}"`);
        }
      }
    }),
  );

  it.effect(
    "engine archive membership replaces parked V1 membership and keeps project metadata",
    () =>
      Effect.gen(function* () {
        const query = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_projects`;
        yield* sql`INSERT INTO projection_projects
        (project_id, title, workspace_root, scripts_json, created_at, updated_at)
        VALUES ('archive-engine-project', 'Gus', '/tmp/gus', '[]',
          '2026-10-09T00:00:00.000Z', '2026-10-09T00:00:00.000Z')`;
        for (const [id, archivedAt] of [
          ["engine-archived", null],
          ["v1-archived", "2026-10-09T00:00:00.000Z"],
        ] as const) {
          yield* sql`INSERT INTO projection_threads
          (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
            created_at, updated_at, archived_at)
          VALUES (${id}, 'archive-engine-project', ${id}, '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access', 'default', '2026-10-09T00:00:00.000Z', '2026-10-09T00:00:00.000Z', ${archivedAt})`;
        }
        const archived = yield* query.getArchivedShellSnapshot([
          { conversationId: "engine-archived", archivedAt: "2026-10-09T01:00:00.000Z" },
        ]);
        assert.deepStrictEqual(
          archived.threads.map(({ id, projectId, title, archivedAt }) => ({
            id,
            projectId,
            title,
            archivedAt,
          })),
          [
            {
              id: ThreadId.make("engine-archived"),
              projectId: ProjectId.make("archive-engine-project"),
              title: "engine-archived",
              archivedAt: "2026-10-09T01:00:00.000Z",
            },
          ],
        );
        assert.deepStrictEqual(
          archived.projects.map(({ id, title }) => ({ id, title })),
          [{ id: "archive-engine-project", title: "Gus" }],
        );
        assert.deepStrictEqual((yield* query.getArchivedShellSnapshot([])).threads, []);
        assert.deepStrictEqual(
          (yield* query.getArchivedShellSnapshot()).threads.map(({ id }) => id),
          ["v1-archived"],
        );
      }),
  );

  it.effect("keeps archived threads out of the main shell snapshot", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-archive-test',
          'Archive Test',
          '/tmp/archive-test',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-active',
            'project-archive-test',
            'Active Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            0,
            0,
            '2026-04-06T00:00:02.000Z',
            '2026-04-06T00:00:03.000Z',
            NULL,
            NULL
          ),
          (
            'thread-archived',
            'project-archive-test',
            'Archived Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            0,
            0,
            '2026-04-06T00:00:04.000Z',
            '2026-04-06T00:00:05.000Z',
            '2026-04-06T00:00:06.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
        VALUES
          (${ORCHESTRATION_PROJECTOR_NAMES.projects}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threads}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadMessages}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadActivities}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadSessions}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.checkpoints}, 4, '2026-04-06T00:00:07.000Z')
      `;

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepEqual(
        shellSnapshot.threads.map((thread) => thread.id),
        [ThreadId.make("thread-active")],
      );

      const archivedShellSnapshot = yield* snapshotQuery.getArchivedShellSnapshot();
      assert.deepEqual(
        archivedShellSnapshot.threads.map((thread) => thread.id),
        [ThreadId.make("thread-archived")],
      );
      assert.equal(archivedShellSnapshot.threads[0]?.archivedAt, "2026-04-06T00:00:06.000Z");
      const activeContext = yield* snapshotQuery.getThreadRuntimeContext(
        ThreadId.make("thread-active"),
      );
      assert.equal(activeContext._tag, "Some");
      if (activeContext._tag === "Some") assert.equal(activeContext.value.session, null);
      for (const threadId of ["thread-archived", "thread-missing"]) {
        assert.equal(
          (yield* snapshotQuery.getThreadRuntimeContext(ThreadId.make(threadId)))._tag,
          "None",
        );
      }
      yield* sql`UPDATE projection_threads SET deleted_at = '2026-04-06T00:00:08.000Z' WHERE thread_id = 'thread-active'`;
      assert.equal(
        (yield* snapshotQuery.getThreadRuntimeContext(ThreadId.make("thread-active")))._tag,
        "None",
      );
    }),
  );

  it.effect("reads the usage pause onto every shell, with the thread's auto-resume switch", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-usage-pause', 'Usage Pause', '/tmp/usage-pause',
          '{"provider":"claudeAgent","model":"opus"}', '[]',
          '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z', NULL
        )
      `;
      const pause = {
        resetsAt: "2026-09-26T13:00:00.000Z",
        window: "5-hour",
        held: 2,
        pausedAt: "2026-09-26T08:30:00.000Z",
      };
      const pauseJson = yield* encodeUsagePause(pause);
      const rows = [
        { id: "thread-not-paused", pause: null, disabledAt: null, expected: null },
        {
          id: "thread-paused",
          pause: pauseJson,
          disabledAt: null,
          expected: { ...pause, autoResume: true },
        },
        {
          id: "thread-paused-manual",
          pause: pauseJson,
          disabledAt: "2026-09-26T09:00:00.000Z",
          expected: { ...pause, autoResume: false },
        },
      ];
      for (const row of rows) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
            latest_user_message_at, pending_approval_count, pending_user_input_count,
            has_actionable_proposed_plan, created_at, updated_at, archived_at, deleted_at,
            usage_pause_json, usage_auto_resume_disabled_at
          ) VALUES (
            ${row.id}, 'project-usage-pause', ${row.id},
            '{"provider":"claudeAgent","model":"opus"}', 'full-access', 'default',
            NULL, 0, 0, 0, '2026-09-26T08:00:00.000Z', '2026-09-26T08:00:00.000Z', NULL, NULL,
            ${row.pause}, ${row.disabledAt}
          )
        `;
      }

      const snapshot = yield* snapshotQuery.getShellSnapshot();
      for (const row of rows) {
        const fromSnapshot = snapshot.threads.find((thread) => thread.id === row.id);
        assert.deepEqual(fromSnapshot?.usagePause, row.expected, `snapshot ${row.id}`);
        const shell = yield* snapshotQuery.getThreadShellById(ThreadId.make(row.id));
        assert.deepEqual(Option.getOrUndefined(shell)?.usagePause, row.expected, `shell ${row.id}`);
      }
    }),
  );

  it.effect("reads a crew thread's origin onto every shell and thread; a person's has none", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-crew', 'Crew', '/var/www',
          '{"provider":"claudeAgent","model":"opus"}', '[]',
          '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z', NULL
        )
      `;
      const crew = { crew: "shop", crewmate: "backend", stint: 2 };
      const crewJson = yield* encodeCrewOrigin(crew);
      const rows = [
        { id: "thread-person", crew: null, archivedAt: null, expected: undefined },
        { id: "thread-stint", crew: crewJson, archivedAt: null, expected: crew },
        {
          id: "thread-retired-stint",
          crew: crewJson,
          archivedAt: "2026-09-27T09:00:00.000Z",
          expected: crew,
        },
      ];
      for (const row of rows) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
            latest_user_message_at, pending_approval_count, pending_user_input_count,
            has_actionable_proposed_plan, created_at, updated_at, archived_at, deleted_at,
            crew_json
          ) VALUES (
            ${row.id}, 'project-crew', ${row.id},
            '{"provider":"claudeAgent","model":"opus"}', 'approval-required', 'default',
            NULL, 0, 0, 0, '2026-09-27T08:00:00.000Z', '2026-09-27T08:00:00.000Z',
            ${row.archivedAt}, NULL, ${row.crew}
          )
        `;
      }

      const shells = (yield* snapshotQuery.getShellSnapshot()).threads;
      const archivedShells = (yield* snapshotQuery.getArchivedShellSnapshot()).threads;
      const snapshotThreads = (yield* snapshotQuery.getSnapshot()).threads;
      const commandThreads = (yield* snapshotQuery.getCommandReadModel()).threads;
      for (const row of rows) {
        const id = ThreadId.make(row.id);
        const live = row.archivedAt === null;
        const readers = {
          shellSnapshot: (live ? shells : archivedShells).find((thread) => thread.id === id),
          snapshot: snapshotThreads.find((thread) => thread.id === id),
          commandReadModel: commandThreads.find((thread) => thread.id === id),
          ...(live
            ? {
                shellById: Option.getOrUndefined(yield* snapshotQuery.getThreadShellById(id)),
                detailById: Option.getOrUndefined(yield* snapshotQuery.getThreadDetailById(id)),
              }
            : {}),
        };
        for (const [reader, thread] of Object.entries(readers)) {
          assert.isDefined(thread, `${reader} ${row.id}`);
          assert.deepEqual(thread?.crew, row.expected, `${reader} ${row.id}`);
          // A person's thread reads exactly as before crews: no key at all.
          assert.strictEqual(thread !== undefined && "crew" in thread, row.expected !== undefined);
        }
      }
    }),
  );

  it.effect("reads the question a waiting thread asks onto every shell; nothing on the rest", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-questions', 'Questions', '/var/www',
          '{"provider":"claudeAgent","model":"opus"}', '[]',
          '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', NULL
        )
      `;
      const asked = (requestId: string, question: string) => ({
        requestId,
        questions: [{ id: "q0", header: "Merge", question, options: [] }],
      });
      const rows = [
        {
          id: "thread-waiting",
          pending: 1,
          archivedAt: null,
          activities: [
            {
              kind: "user-input.requested",
              payload: asked("req-1", "Ship the status page now, or after the review?"),
            },
          ],
          expected: "Ship the status page now, or after the review?",
        },
        {
          id: "thread-answered",
          pending: 0,
          archivedAt: null,
          activities: [
            { kind: "user-input.requested", payload: asked("req-2", "Which colour?") },
            {
              kind: "user-input.resolved",
              payload: { requestId: "req-2", answers: {} },
            },
          ],
          expected: undefined,
        },
        { id: "thread-idle", pending: 0, archivedAt: null, activities: [], expected: undefined },
        {
          id: "thread-waiting-archived",
          pending: 1,
          archivedAt: "2026-09-29T09:00:00.000Z",
          activities: [
            { kind: "user-input.requested", payload: asked("req-3", "Keep the old route?") },
          ],
          expected: "Keep the old route?",
        },
      ];
      for (const row of rows) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
            latest_user_message_at, pending_approval_count, pending_user_input_count,
            has_actionable_proposed_plan, created_at, updated_at, archived_at, deleted_at
          ) VALUES (
            ${row.id}, 'project-questions', ${row.id},
            '{"provider":"claudeAgent","model":"opus"}', 'full-access', 'default',
            NULL, 0, ${row.pending}, 0, '2026-09-29T08:00:00.000Z', '2026-09-29T08:00:00.000Z',
            ${row.archivedAt}, NULL
          )
        `;
        for (const [index, activity] of row.activities.entries()) {
          yield* sql`
            INSERT INTO projection_thread_activities (
              activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence,
              created_at
            ) VALUES (
              ${`${row.id}-activity-${index}`}, ${row.id}, NULL, 'info', ${activity.kind},
              'User input', ${yield* encodeActivityPayload(activity.payload)}, ${index + 1},
              ${`2026-09-29T08:00:0${index + 1}.000Z`}
            )
          `;
        }
      }

      const shells = (yield* snapshotQuery.getShellSnapshot()).threads;
      const archivedShells = (yield* snapshotQuery.getArchivedShellSnapshot()).threads;
      for (const row of rows) {
        const id = ThreadId.make(row.id);
        const live = row.archivedAt === null;
        const readers = {
          shellSnapshot: (live ? shells : archivedShells).find((thread) => thread.id === id),
          ...(live
            ? { shellById: Option.getOrUndefined(yield* snapshotQuery.getThreadShellById(id)) }
            : {}),
        };
        for (const [reader, thread] of Object.entries(readers)) {
          assert.isDefined(thread, `${reader} ${row.id}`);
          assert.strictEqual(thread?.pendingQuestion, row.expected, `${reader} ${row.id}`);
          assert.strictEqual(thread?.hasPendingUserInput, row.expected !== undefined);
        }
      }
    }),
  );

  it.effect("reads a live step onto a shell only while its session runs a turn", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const liveSteps = yield* ThreadLiveStep.ThreadLiveStepService;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-live', 'Live', '/var/www',
          '{"provider":"claudeAgent","model":"opus"}', '[]',
          '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', NULL
        )
      `;
      const writing = { kind: "writing", since: "2026-09-29T08:00:04.000Z" };
      const rows = [
        {
          id: "thread-working",
          status: "running",
          turn: "turn-1",
          archivedAt: null,
          crew: null,
          carries: true,
        },
        {
          id: "thread-errored",
          status: "error",
          turn: "turn-1",
          archivedAt: null,
          crew: null,
          carries: false,
        },
        {
          id: "thread-between",
          status: "running",
          turn: null,
          archivedAt: null,
          crew: null,
          carries: false,
        },
        {
          id: "thread-no-session",
          status: null,
          turn: null,
          archivedAt: null,
          crew: null,
          carries: false,
        },
        {
          id: "thread-archived",
          status: "running",
          turn: "turn-1",
          archivedAt: "2026-09-29T09:00:00.000Z",
          crew: null,
          carries: false,
        },
        // A crewmate's conversation: the Crew tab's row says its step as the menu's does.
        {
          id: "thread-crewmate",
          status: "running",
          turn: "turn-1",
          archivedAt: null,
          crew: '{"crew":"main","crewmate":"backend","stint":1}',
          carries: true,
        },
      ];
      for (const row of rows) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
            latest_user_message_at, pending_approval_count, pending_user_input_count,
            has_actionable_proposed_plan, created_at, updated_at, archived_at, deleted_at,
            crew_json
          ) VALUES (
            ${row.id}, 'project-live', ${row.id},
            '{"provider":"claudeAgent","model":"opus"}', 'full-access', 'default',
            NULL, 0, 0, 0, '2026-09-29T08:00:00.000Z', '2026-09-29T08:00:00.000Z',
            ${row.archivedAt}, NULL, ${row.crew}
          )
        `;
        if (row.status !== null) {
          yield* sql`
            INSERT INTO projection_thread_sessions (
              thread_id, status, provider_name, provider_session_id, provider_thread_id,
              runtime_mode, active_turn_id, last_error, updated_at
            ) VALUES (
              ${row.id}, ${row.status}, 'claudeAgent', NULL, NULL,
              'full-access', ${row.turn}, NULL, '2026-09-29T08:00:00.000Z'
            )
          `;
        }
        // The relay holds a step for every one of them: only a running turn's shell says it.
        liveSteps.observe(row.id, {
          type: "turn-started",
          at: "2026-09-29T08:00:00.000Z",
          byTiming: false,
        });
        liveSteps.observe(row.id, { type: "writing", at: "2026-09-29T08:00:04.000Z" });
      }

      const shells = (yield* snapshotQuery.getShellSnapshot()).threads;
      const archivedShells = (yield* snapshotQuery.getArchivedShellSnapshot()).threads;
      for (const row of rows) {
        const id = ThreadId.make(row.id);
        const live = row.archivedAt === null;
        const readers = {
          shellSnapshot: (live ? shells : archivedShells).find((thread) => thread.id === id),
          ...(live
            ? { shellById: Option.getOrUndefined(yield* snapshotQuery.getThreadShellById(id)) }
            : {}),
        };
        for (const [reader, thread] of Object.entries(readers)) {
          assert.isDefined(thread, `${reader} ${row.id}`);
          // A thread with nothing running reads as before: no key at all.
          assert.deepEqual(
            thread?.liveStep,
            row.carries ? writing : undefined,
            `${reader} ${row.id}`,
          );
          assert.strictEqual(thread !== undefined && "liveStep" in thread, row.carries);
        }
        liveSteps.clearThread(row.id);
      }
    }),
  );

  it.effect("keeps settled threads in the shell snapshot with non-null settlement fields", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-settled-test',
          'Settled Test',
          '/tmp/settled-test',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          settled_override,
          settled_at,
          deleted_at
        )
        VALUES (
          'thread-settled',
          'project-settled-test',
          'Settled Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-04-06T00:00:02.000Z',
          '2026-04-06T00:00:05.000Z',
          NULL,
          'settled',
          '2026-04-06T00:00:04.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
        VALUES
          (${ORCHESTRATION_PROJECTOR_NAMES.projects}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threads}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadMessages}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadActivities}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadSessions}, 4, '2026-04-06T00:00:07.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.checkpoints}, 4, '2026-04-06T00:00:07.000Z')
      `;

      // Settled ≠ archived: the thread must appear in the LIVE shell
      // snapshot, carrying its settlement fields through the row aliases.
      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepEqual(
        shellSnapshot.threads.map((thread) => thread.id),
        [ThreadId.make("thread-settled")],
      );
      assert.equal(shellSnapshot.threads[0]?.settledOverride, "settled");
      assert.equal(shellSnapshot.threads[0]?.settledAt, "2026-04-06T00:00:04.000Z");

      // And the full command read model carries them too.
      const readModel = yield* snapshotQuery.getCommandReadModel();
      const thread = readModel.threads.find(
        (candidate) => candidate.id === ThreadId.make("thread-settled"),
      );
      assert.equal(thread?.settledOverride, "settled");
      assert.equal(thread?.settledAt, "2026-04-06T00:00:04.000Z");
    }),
  );

  it.effect(
    "reads targeted project, thread, and count queries without hydrating the full snapshot",
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;

        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_turns`;

        yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'project-active',
            'Active Project',
            '/tmp/workspace',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-03-01T00:00:00.000Z',
            '2026-03-01T00:00:01.000Z',
            NULL
          ),
          (
            'project-deleted',
            'Deleted Project',
            '/tmp/deleted',
            NULL,
            '[]',
            '2026-03-01T00:00:02.000Z',
            '2026-03-01T00:00:03.000Z',
            '2026-03-01T00:00:04.000Z'
          )
      `;

        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-first',
            'project-active',
            'First Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:05.000Z',
            '2026-03-01T00:00:06.000Z',
            NULL,
            NULL
          ),
          (
            'thread-second',
            'project-active',
            'Second Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:07.000Z',
            '2026-03-01T00:00:08.000Z',
            NULL,
            NULL
          ),
          (
            'thread-deleted',
            'project-active',
            'Deleted Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:09.000Z',
            '2026-03-01T00:00:10.000Z',
            NULL,
            '2026-03-01T00:00:11.000Z'
          )
      `;

        const counts = yield* snapshotQuery.getCounts();
        assert.deepEqual(counts, {
          projectCount: 2,
          threadCount: 3,
        });

        const project = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/workspace");
        assert.equal(project._tag, "Some");
        if (project._tag === "Some") {
          assert.equal(project.value.id, asProjectId("project-active"));
        }

        const missingProject = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/missing");
        assert.equal(missingProject._tag, "None");

        const firstThreadId = yield* snapshotQuery.getFirstActiveThreadIdByProjectId(
          asProjectId("project-active"),
        );
        assert.equal(firstThreadId._tag, "Some");
        if (firstThreadId._tag === "Some") {
          assert.equal(firstThreadId.value, ThreadId.make("thread-first"));
        }
      }),
  );

  it.effect("measures replay payload bytes without decoding event bodies", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM orchestration_events`;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        )
        VALUES
          (
            'replay-event-1', 'thread', 'thread-replay', 1, 'thread.activity-appended',
            '2026-03-01T00:00:00.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', printf('%.*c', 1000, 'x')), '{}'
          ),
          (
            'replay-event-2', 'thread', 'thread-replay', 2, 'thread.activity-appended',
            '2026-03-01T00:00:01.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', printf('%.*c', 2000, 'x')), '{}'
          ),
          (
            'replay-event-3', 'thread', 'thread-replay', 3, 'thread.activity-appended',
            '2026-03-01T00:00:02.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', printf('%.*c', 3000, 'x')), '{}'
          ),
          (
            'replay-event-4', 'thread', 'thread-replay', 4, 'thread.activity-appended',
            '2026-03-01T00:00:03.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', '😀'), '{}'
          )
      `;

      // Bytes, not code points: the 4-byte emoji row is {"output":"😀"}, 17 bytes.
      const stats = yield* snapshotQuery.getEventReplayStats({
        fromSequenceExclusive: 1,
        toSequenceInclusive: 4,
      });
      assert.deepStrictEqual(stats, {
        eventCount: 3,
        payloadBytes: 5043,
      });
    }),
  );

  it.effect("reads single-thread checkpoint context without hydrating unrelated threads", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-context',
          'Context Project',
          '/tmp/context-workspace',
          NULL,
          '[]',
          '2026-03-02T00:00:00.000Z',
          '2026-03-02T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-context',
          'project-context',
          'Context Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          'feature/perf',
          '/tmp/context-worktree',
          NULL,
          '2026-03-02T00:00:02.000Z',
          '2026-03-02T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-context',
            'turn-1',
            NULL,
            NULL,
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            1,
            'checkpoint-a',
            'ready',
            '[]'
          ),
          (
            'thread-context',
            'turn-2',
            NULL,
            NULL,
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            2,
            'checkpoint-b',
            'ready',
            '[]'
          )
      `;

      const context = yield* snapshotQuery.getThreadCheckpointContext(
        ThreadId.make("thread-context"),
      );
      assert.equal(context._tag, "Some");
      if (context._tag === "Some") {
        assert.deepEqual(context.value, {
          threadId: ThreadId.make("thread-context"),
          projectId: asProjectId("project-context"),
          workspaceRoot: "/tmp/context-workspace",
          worktreePath: "/tmp/context-worktree",
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-a"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:04.000Z",
            },
            {
              turnId: asTurnId("turn-2"),
              checkpointTurnCount: 2,
              checkpointRef: asCheckpointRef("checkpoint-b"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:05.000Z",
            },
          ],
        });
      }
    }),
  );

  it.effect("keeps thread detail activity ordering consistent with shell snapshot ordering", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-01T00:00:00.000Z',
          '2026-04-01T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-04-01T00:00:02.000Z',
          '2026-04-01T00:00:03.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          (
            'activity-unsequenced',
            'thread-1',
            NULL,
            'info',
            'runtime.note',
            'unsequenced first',
            '{"source":"unsequenced"}',
            NULL,
            '2026-04-01T00:00:06.000Z'
          ),
          (
            'activity-sequence-2',
            'thread-1',
            NULL,
            'info',
            'runtime.note',
            'sequence two',
            '{"source":"sequence-2"}',
            2,
            '2026-04-01T00:00:04.000Z'
          ),
          (
            'activity-sequence-1',
            'thread-1',
            NULL,
            'info',
            'runtime.note',
            'sequence one',
            '{"source":"sequence-1"}',
            1,
            '2026-04-01T00:00:05.000Z'
          )
      `;

      const snapshot = yield* snapshotQuery.getSnapshot();
      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));

      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.deepEqual(threadDetail.value.activities, snapshot.threads[0]?.activities ?? []);
      }

      assert.deepEqual(snapshot.threads[0]?.activities ?? [], [
        {
          id: asEventId("activity-unsequenced"),
          tone: "info",
          kind: "runtime.note",
          summary: "unsequenced first",
          payload: { source: "unsequenced" },
          turnId: null,
          createdAt: "2026-04-01T00:00:06.000Z",
        },
        {
          id: asEventId("activity-sequence-1"),
          tone: "info",
          kind: "runtime.note",
          summary: "sequence one",
          payload: { source: "sequence-1" },
          turnId: null,
          sequence: 1,
          createdAt: "2026-04-01T00:00:05.000Z",
        },
        {
          id: asEventId("activity-sequence-2"),
          tone: "info",
          kind: "runtime.note",
          summary: "sequence two",
          payload: { source: "sequence-2" },
          turnId: null,
          sequence: 2,
          createdAt: "2026-04-01T00:00:04.000Z",
        },
      ]);
    }),
  );

  it.effect("uses projection_threads.latest_turn_id for targeted thread latest turn queries", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-02T00:00:00.000Z',
          '2026-04-02T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          'turn-running',
          '2026-04-02T00:00:04.000Z',
          0,
          0,
          0,
          '2026-04-02T00:00:02.000Z',
          '2026-04-02T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-1',
            'turn-completed',
            'message-user-1',
            NULL,
            NULL,
            'message-assistant-1',
            'completed',
            '2026-04-02T00:00:05.000Z',
            '2026-04-02T00:00:06.000Z',
            '2026-04-02T00:00:20.000Z',
            5,
            'checkpoint-5',
            'ready',
            '[]'
          ),
          (
            'thread-1',
            'turn-running',
            'message-user-2',
            NULL,
            NULL,
            NULL,
            'running',
            '2026-04-02T00:00:30.000Z',
            '2026-04-02T00:00:30.000Z',
            NULL,
            NULL,
            NULL,
            NULL,
            '[]'
          )
      `;

      const threadShell = yield* snapshotQuery.getThreadShellById(ThreadId.make("thread-1"));
      assert.equal(threadShell._tag, "Some");
      if (threadShell._tag === "Some") {
        assert.equal(threadShell.value.latestTurn?.turnId, asTurnId("turn-running"));
        assert.equal(threadShell.value.latestTurn?.state, "running");
        assert.equal(threadShell.value.latestTurn?.startedAt, "2026-04-02T00:00:30.000Z");
      }

      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));
      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.equal(threadDetail.value.latestTurn?.turnId, asTurnId("turn-running"));
        assert.equal(threadDetail.value.latestTurn?.state, "running");
        assert.equal(threadDetail.value.latestTurn?.startedAt, "2026-04-02T00:00:30.000Z");
      }
    }),
  );

  it.effect("uses projection_threads.latest_turn_id for bulk command and shell snapshots", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-03T00:00:00.000Z',
          '2026-04-03T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          'turn-running',
          '2026-04-03T00:00:04.000Z',
          0,
          0,
          0,
          '2026-04-03T00:00:02.000Z',
          '2026-04-03T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-1',
            'turn-running',
            'message-user-2',
            NULL,
            NULL,
            NULL,
            'running',
            '2026-04-03T00:00:30.000Z',
            '2026-04-03T00:00:30.000Z',
            NULL,
            NULL,
            NULL,
            NULL,
            '[]'
          ),
          (
            'thread-1',
            'turn-completed',
            'message-user-1',
            NULL,
            NULL,
            'message-assistant-1',
            'completed',
            '2026-04-03T00:00:05.000Z',
            '2026-04-03T00:00:06.000Z',
            '2026-04-03T00:00:20.000Z',
            NULL,
            NULL,
            NULL,
            '[]'
          )
      `;

      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
        VALUES
          (${ORCHESTRATION_PROJECTOR_NAMES.projects}, 3, '2026-04-03T00:00:40.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threads}, 3, '2026-04-03T00:00:40.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadMessages}, 3, '2026-04-03T00:00:40.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans}, 3, '2026-04-03T00:00:40.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadActivities}, 3, '2026-04-03T00:00:40.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.threadSessions}, 3, '2026-04-03T00:00:40.000Z'),
          (${ORCHESTRATION_PROJECTOR_NAMES.checkpoints}, 3, '2026-04-03T00:00:40.000Z')
      `;

      const commandReadModel = yield* snapshotQuery.getCommandReadModel();
      assert.equal(commandReadModel.threads[0]?.latestTurn?.turnId, asTurnId("turn-running"));
      assert.equal(commandReadModel.threads[0]?.latestTurn?.state, "running");

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.threads[0]?.latestTurn?.turnId, asTurnId("turn-running"));
      assert.equal(shellSnapshot.threads[0]?.latestTurn?.state, "running");

      const fullSnapshot = yield* snapshotQuery.getSnapshot();
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.turnId, asTurnId("turn-running"));
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.state, "running");
    }),
  );

  it.effect("keeps deleted project and thread tombstones in the command read model", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-deleted',
          'Deleted Project',
          '/tmp/deleted-project',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-05T00:00:00.000Z',
          '2026-04-05T00:00:01.000Z',
          '2026-04-05T00:00:02.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-deleted',
          'project-deleted',
          'Deleted Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          'turn-deleted',
          NULL,
          0,
          0,
          0,
          '2026-04-05T00:00:03.000Z',
          '2026-04-05T00:00:04.000Z',
          NULL,
          '2026-04-05T00:00:05.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-deleted',
          'turn-deleted',
          'message-deleted-user',
          NULL,
          NULL,
          'message-deleted-assistant',
          'completed',
          '2026-04-05T00:00:04.100Z',
          '2026-04-05T00:00:04.200Z',
          '2026-04-05T00:00:04.300Z',
          NULL,
          NULL,
          NULL,
          '[]'
        )
      `;

      const commandReadModel = yield* snapshotQuery.getCommandReadModel();
      assert.equal(commandReadModel.projects[0]?.id, asProjectId("project-deleted"));
      assert.equal(commandReadModel.projects[0]?.deletedAt, "2026-04-05T00:00:02.000Z");
      assert.equal(commandReadModel.threads[0]?.id, ThreadId.make("thread-deleted"));
      assert.equal(commandReadModel.threads[0]?.deletedAt, "2026-04-05T00:00:05.000Z");
      assert.equal(commandReadModel.threads[0]?.latestTurn?.turnId, asTurnId("turn-deleted"));
      assert.equal(commandReadModel.threads[0]?.latestTurn?.state, "completed");

      const fullSnapshot = yield* snapshotQuery.getSnapshot();
      assert.equal(fullSnapshot.threads[0]?.id, ThreadId.make("thread-deleted"));
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.turnId, asTurnId("turn-deleted"));
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.state, "completed");

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.projects.length, 0);
      assert.equal(shellSnapshot.threads.length, 0);
    }),
  );

  it.effect("searches active user messages and canonical assistant outputs", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-search',
          'Project Needle',
          '/tmp/project-search',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-05-01T00:00:00.000Z',
          '2026-05-01T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-active',
            'project-search',
            'Literal 100% fix',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            'search-branch',
            NULL,
            'turn-active',
            '2026-05-01T00:00:02.000Z',
            0,
            0,
            0,
            '2026-05-01T00:00:02.000Z',
            '2026-05-01T00:00:03.000Z',
            NULL,
            NULL
          ),
          (
            'thread-percent-decoy',
            'project-search',
            'Literal 100x fix',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            0,
            0,
            '2026-05-01T00:00:04.000Z',
            '2026-05-01T00:00:05.000Z',
            NULL,
            NULL
          ),
          (
            'thread-hidden',
            'project-search',
            'Archived search',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            0,
            0,
            '2026-05-01T00:00:06.000Z',
            '2026-05-01T00:00:07.000Z',
            '2026-05-01T00:00:08.000Z',
            NULL
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES
          (
            'message-user',
            'thread-active',
            'turn-active',
            'user',
            'Please find this USER needle in an old prompt, password=hunter2026.',
            0,
            '2026-05-01T00:00:12.000Z',
            '2026-05-01T00:00:12.000Z'
          ),
          (
            'message-percent',
            'thread-active',
            NULL,
            'user',
            'Literal 100% fix in a prompt.',
            0,
            '2026-05-01T00:00:11.000Z',
            '2026-05-01T00:00:11.000Z'
          ),
          (
            'message-percent-decoy',
            'thread-percent-decoy',
            NULL,
            'user',
            'Literal 100x fix in a prompt.',
            0,
            '2026-05-01T00:00:11.000Z',
            '2026-05-01T00:00:11.000Z'
          ),
          (
            'message-final',
            'thread-active',
            'turn-active',
            'assistant',
            'The canonical final needle appears in this completed answer.',
            0,
            '2026-05-01T00:00:13.000Z',
            '2026-05-01T00:00:13.000Z'
          ),
          (
            'message-interim',
            'thread-active',
            'turn-active',
            'assistant',
            'Interim needle must not be searchable.',
            0,
            '2026-05-01T00:00:14.000Z',
            '2026-05-01T00:00:14.000Z'
          ),
          (
            'message-system',
            'thread-active',
            NULL,
            'system',
            'System needle must not be searchable.',
            0,
            '2026-05-01T00:00:15.000Z',
            '2026-05-01T00:00:15.000Z'
          ),
          (
            'message-hidden',
            'thread-hidden',
            NULL,
            'user',
            'Hidden needle in archive.',
            0,
            '2026-05-01T00:00:16.000Z',
            '2026-05-01T00:00:16.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_files_json
        )
        VALUES (
          'thread-active',
          'turn-active',
          'message-user',
          'message-final',
          'completed',
          '2026-05-01T00:00:12.000Z',
          '2026-05-01T00:00:12.000Z',
          '2026-05-01T00:00:13.000Z',
          '[]'
        )
      `;

      const literalPercent = yield* snapshotQuery.searchThreads({ query: "100%" });
      assert.deepStrictEqual(
        literalPercent.matches.map((match) => [match.threadId, match.source]),
        [[ThreadId.make("thread-active"), "user"]],
      );

      const user = yield* snapshotQuery.searchThreads({ query: "user needle" });
      assert.equal(user.matches[0]?.source, "user");
      assert.match(user.matches[0]?.snippet ?? "", /USER needle/);
      // What was pasted into a conversation is found, never quoted.
      assert.match(user.matches[0]?.snippet ?? "", /password=••••••\./);

      const assistant = yield* snapshotQuery.searchThreads({ query: "FINAL NEEDLE" });
      assert.equal(assistant.matches[0]?.source, "assistant");

      const deduped = yield* snapshotQuery.searchThreads({ query: "needle" });
      assert.deepStrictEqual(
        deduped.matches.map((match) => [match.threadId, match.source]),
        [[ThreadId.make("thread-active"), "user"]],
      );

      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "interim needle" })).matches,
        [],
      );
      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "system needle" })).matches,
        [],
      );
      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "hidden needle" })).matches,
        [],
      );
      yield* sql`
        UPDATE projection_threads
        SET deleted_at = '2026-05-01T00:00:20.000Z'
        WHERE thread_id = 'thread-active'
      `;
      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "user needle" })).matches,
        [],
      );
    }),
  );
});

it.effect(
  "ProjectionSnapshotQuery dedupes repository identity resolution by workspace root and skips deleted projects for shell snapshots",
  () => {
    const resolveCalls: string[] = [];
    const layer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(ThreadLiveStep.layer),
      Layer.provideMerge(
        Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
          resolve: (cwd: string) =>
            Effect.sync(() => {
              resolveCalls.push(cwd);
              return {
                canonicalKey: `github.com/acme${cwd}`,
                locator: {
                  source: "git-remote" as const,
                  remoteName: "origin",
                  remoteUrl: `https://github.com/acme${cwd}.git`,
                },
                rootPath: cwd,
              };
            }),
        }),
      ),
      Layer.provideMerge(SqlitePersistenceMemory),
    );

    return Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'project-1',
            'Shared Project 1',
            '/tmp/shared-root',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-04-04T00:00:00.000Z',
            '2026-04-04T00:00:01.000Z',
            NULL
          ),
          (
            'project-2',
            'Shared Project 2',
            '/tmp/shared-root',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-04-04T00:00:02.000Z',
            '2026-04-04T00:00:03.000Z',
            NULL
          ),
          (
            'project-3',
            'Deleted Project',
            '/tmp/deleted-root',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-04-04T00:00:04.000Z',
            '2026-04-04T00:00:05.000Z',
            '2026-04-04T00:00:06.000Z'
          )
      `;

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepStrictEqual(resolveCalls.toSorted(), ["/tmp/shared-root"]);
      assert.equal(shellSnapshot.projects.length, 2);
      assert.equal(shellSnapshot.projects[0]?.repositoryIdentity?.rootPath, "/tmp/shared-root");
      assert.equal(shellSnapshot.projects[1]?.repositoryIdentity?.rootPath, "/tmp/shared-root");

      resolveCalls.length = 0;

      const fullSnapshot = yield* snapshotQuery.getSnapshot();
      assert.deepStrictEqual(resolveCalls.toSorted(), ["/tmp/deleted-root", "/tmp/shared-root"]);
      assert.equal(fullSnapshot.projects.length, 3);
      assert.equal(fullSnapshot.projects[2]?.repositoryIdentity?.rootPath, "/tmp/deleted-root");
    }).pipe(Effect.provide(layer));
  },
);

const fillBudgetColumns = Effect.fnUntraced(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ activityId: string; kind: string; payload: string }>`
    SELECT activity_id AS "activityId", kind, payload_json AS "payload"
    FROM projection_thread_activities
  `;
  for (const row of rows) {
    const columns = budgetColumnsOf(row.kind, yield* decodeActivityPayload(row.payload));
    yield* sql`
      UPDATE projection_thread_activities
      SET ${sql.update(columns)}
      WHERE activity_id = ${row.activityId}
    `;
  }
});

projectionSnapshotLayer("ProjectionSnapshotQuery windowed thread detail", (it) => {
  // A thread shaped like real fan-out usage: user turns interleaved with
  // subagent turns (no user pending message), plus a turnless straggler user
  // message and a turnless activity anchored between turns.
  //
  //   row  turn      pending msg        anchor (requested_at)
  //   1    turn-1    user-msg-1         T00
  //   2    turn-2    (subagent)         T01
  //   3    turn-3    (subagent)         T02
  //   4    turn-4    user-msg-4         T03
  //   5    turn-5    user-msg-5         T04
  //
  // Straggler user message at T03.5 (turn_id NULL, not any pending_message_id)
  // and a turnless activity at T03.6 — both belong to the page containing T03+.
  const seedFanOutThread = Effect.fnUntraced(function* () {
    const sql = yield* SqlClient.SqlClient;

    // Tests in this block share one in-memory database; reset before seeding.
    yield* sql`DELETE FROM projection_projects`;
    yield* sql`DELETE FROM projection_threads`;
    yield* sql`DELETE FROM projection_turns`;
    yield* sql`DELETE FROM projection_thread_messages`;
    yield* sql`DELETE FROM projection_thread_activities`;
    yield* sql`DELETE FROM projection_state`;

    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
      )
      VALUES ('project-w', 'Windowed', '/tmp/project-w', '[]',
        '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', NULL)
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        latest_turn_id, pending_approval_count, pending_user_input_count,
        has_actionable_proposed_plan, created_at, updated_at, deleted_at
      )
      VALUES ('thread-w', 'project-w', 'Windowed thread',
        '{"provider":"codex","model":"gpt-5-codex"}', 'full-access', 'default',
        'turn-5', 0, 0, 0, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:10.000Z', NULL)
    `;

    const turns: ReadonlyArray<{
      turn: string;
      pendingMessage: string | null;
      at: string;
    }> = [
      { turn: "turn-1", pendingMessage: "user-msg-1", at: "2026-03-01T00:00:00.000Z" },
      { turn: "turn-2", pendingMessage: null, at: "2026-03-01T00:01:00.000Z" },
      { turn: "turn-3", pendingMessage: null, at: "2026-03-01T00:02:00.000Z" },
      { turn: "turn-4", pendingMessage: "user-msg-4", at: "2026-03-01T00:03:00.000Z" },
      { turn: "turn-5", pendingMessage: "user-msg-5", at: "2026-03-01T00:04:00.000Z" },
    ];
    for (const { turn, pendingMessage, at } of turns) {
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, state, requested_at, started_at, completed_at,
          checkpoint_files_json
        )
        VALUES ('thread-w', ${turn}, ${pendingMessage}, 'completed', ${at}, ${at}, ${at}, '[]')
      `;
      if (pendingMessage !== null) {
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
          )
          VALUES (${pendingMessage}, 'thread-w', NULL, 'user', ${"prompt for " + turn}, 0, ${at}, ${at})
        `;
      }
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        )
        VALUES (${turn + "-reply"}, 'thread-w', ${turn}, 'assistant', ${"reply from " + turn}, 0, ${at}, ${at})
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
        )
        VALUES (${turn + "-activity"}, 'thread-w', ${turn}, 'tool', 'tool.completed',
          'ran tool', '{"ok":true}', ${at})
      `;
    }

    // Straggler user message sent while turn-4 ran: turn_id NULL and not any
    // turn's pending_message_id.
    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
      )
      VALUES ('user-msg-straggler', 'thread-w', NULL, 'user', 'while you are at it',
        0, '2026-03-01T00:03:30.000Z', '2026-03-01T00:03:30.000Z')
    `;
    // Turnless activity in the same time range.
    yield* sql`
      INSERT INTO projection_thread_activities (
        activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at
      )
      VALUES ('turnless-activity', 'thread-w', NULL, 'info', 'context-window.updated',
        'usage', '{"usedTokens":1}', '2026-03-01T00:03:36.000Z')
    `;

    for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
        VALUES (${projector}, 42, '2026-03-01T00:00:10.000Z')
      `;
    }
  });

  const threadW = ThreadId.make("thread-w");
  const messageIds = (snapshot: { thread: { messages: ReadonlyArray<{ id: string }> } }) =>
    snapshot.thread.messages.map((message) => message.id).toSorted();
  const activityIds = (snapshot: { thread: { activities: ReadonlyArray<{ id: string }> } }) =>
    snapshot.thread.activities.map((activity) => activity.id).toSorted();

  it.effect(
    "keeps task lifecycles outside the work-log cap when a client reloads, scoped to its page",
    () =>
      Effect.gen(function* () {
        yield* seedFanOutThread();
        const query = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM projection_thread_activities`;
        yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES
          ('old-helper', 'thread-w', 'turn-1', 'tool', 'task.started', 'Earlier helper',
            '{"taskId":"old","taskType":"subagent"}', 1, '2026-03-01T00:00:00.000Z'),
          ('helper-start', 'thread-w', 'turn-5', 'tool', 'task.started', 'Review',
            '{"taskId":"helper","taskType":"subagent","title":"Review"}', 2, '2026-03-01T00:04:00.000Z'),
          ('helper-progress', 'thread-w', 'turn-5', 'tool', 'task.progress', 'Working',
            '{"taskId":"helper","status":"running"}', 3, '2026-03-01T00:04:01.000Z'),
          ('helper-update', 'thread-w', 'turn-5', 'tool', 'task.updated', 'Idle',
            '{"taskId":"helper","status":"idle"}', 4, '2026-03-01T00:04:02.000Z'),
          ('helper-end', 'thread-w', 'turn-5', 'tool', 'task.completed', 'Done',
            '{"taskId":"helper","status":"completed"}', 5, '2026-03-01T00:04:03.000Z')
      `;
        let calls = 0;
        const seedCallsUpTo = (count: number) =>
          Effect.gen(function* () {
            yield* sql`
            WITH RECURSIVE seeded(n) AS (
              VALUES (${calls + 1}) UNION ALL SELECT n + 1 FROM seeded WHERE n < ${count}
            )
            INSERT INTO projection_thread_activities (
              activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
            )
            SELECT 'call-' || n, 'thread-w', 'turn-5', 'tool', 'tool.completed', 'Tool',
              '{}', n + 5, '2026-03-01T00:04:04.000Z' FROM seeded
          `;
            calls = count;
          });
        // Each read one call past its own cap (500 unpaged, 3,000 a page); the last unpaged read
        // holds the lifecycles beyond its scan, where a progress tick is superseded by later ones.
        for (const { window, seed, cap, lifecycles } of [
          {
            window: undefined,
            seed: 501,
            cap: 500,
            lifecycles: [
              "old-helper",
              "helper-start",
              "helper-progress",
              "helper-update",
              "helper-end",
            ],
          },
          {
            window: { turnLimit: 1 },
            seed: 3_001,
            cap: 3_000,
            lifecycles: ["helper-start", "helper-progress", "helper-update", "helper-end"],
          },
          {
            window: undefined,
            seed: 3_001,
            cap: 500,
            lifecycles: ["old-helper", "helper-start", "helper-update", "helper-end"],
          },
        ]) {
          if (seed > calls) yield* seedCallsUpTo(seed);
          const snapshot = yield* query.getThreadDetailSnapshot(threadW, window);
          assert(Option.isSome(snapshot));
          const activities = snapshot.value.thread.activities;
          assert.deepEqual(
            activities
              .filter((activity) => activity.kind.startsWith("task."))
              .map((activity) => activity.id),
            lifecycles,
          );
          assert.equal(
            activities.filter((activity) => activity.kind === "tool.completed").length,
            cap,
          );
          assert.equal(new Set(activities.map((activity) => activity.id)).size, activities.length);
        }
        // A lifecycle in both selections must be delivered once, in sequence order.
        yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        ) VALUES ('recent-helper', 'thread-w', 'turn-5', 'tool', 'task.updated', 'Done',
          '{"taskId":"helper","status":"completed"}', 3007, '2026-03-01T00:04:05.000Z')
      `;
        const snapshot = yield* query.getThreadDetailSnapshot(threadW, { turnLimit: 1 });
        assert(Option.isSome(snapshot));
        assert.equal(
          snapshot.value.thread.activities.filter((activity) => activity.id === "recent-helper")
            .length,
          1,
        );
        assert.equal(snapshot.value.thread.activities.at(-1)?.id, "recent-helper");
      }),
  );

  it.effect("returns the full thread with no page metadata when no window is requested", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW);
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.page, undefined);
        assert.equal(snapshot.value.thread.messages.length, 9);
        assert.equal(snapshot.value.thread.activities.length, 6);
        assert.equal(snapshot.value.snapshotSequence, 42);
      }
    }),
  );

  it.effect("windows to the last N user-anchored turns with subagent turns riding along", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      // turnLimit 2 walks back: turn-5 (user), turn-4 (user) -> window is
      // rows 4..5. Subagent turns 2-3 are older than the 2nd user turn and
      // stay out; the straggler message and turnless activity (T03.5/T03.6,
      // after turn-4's anchor) ride along.
      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.deepEqual(messageIds(snapshot.value), [
          "turn-4-reply",
          "turn-5-reply",
          "user-msg-4",
          "user-msg-5",
          "user-msg-straggler",
        ]);
        assert.deepEqual(activityIds(snapshot.value), [
          "turn-4-activity",
          "turn-5-activity",
          "turnless-activity",
        ]);
        assert.equal(snapshot.value.page?.hasMore, true);
        assert.notEqual(snapshot.value.page?.beforeCursor, null);
        assert.equal(snapshot.value.page?.snapshotSequence, 42);
      }
    }),
  );

  it.effect("subagent turns between user turns ride along inside the window", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      // turnLimit 3 reaches user turn-1, dragging subagent turns 2-3 along:
      // the full thread, so no further pages.
      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 3 });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.thread.messages.length, 9);
        assert.equal(snapshot.value.thread.activities.length, 6);
        assert.equal(snapshot.value.page?.hasMore, false);
        assert.equal(snapshot.value.page?.beforeCursor, null);
      }
    }),
  );

  it.effect("cursors survive a projection rewrite that reassigns turn row ids", () =>
    Effect.gen(function* () {
      // The revert projector (and any projection rebuild) deletes and
      // re-upserts projection_turns, assigning fresh autoincrement row ids.
      // The keyset cursor is derived from event content, so a page cursor
      // minted before the rewrite must keep working after it.
      yield* seedFanOutThread();
      const sql = yield* SqlClient.SqlClient;
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const firstPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(firstPage._tag, "Some");
      if (firstPage._tag !== "Some") return;
      const cursor = firstPage.value.page?.beforeCursor;
      assert.notEqual(cursor, null);
      if (cursor === null || cursor === undefined) return;

      // Simulate the rewrite: delete and re-insert every turn row with the
      // same content, which reassigns all row ids.
      const turnRows = yield* sql`
        SELECT thread_id, turn_id, pending_message_id, state, requested_at, started_at,
          completed_at, checkpoint_files_json
        FROM projection_turns WHERE thread_id = 'thread-w' ORDER BY row_id
      `;
      yield* sql`DELETE FROM projection_turns WHERE thread_id = 'thread-w'`;
      for (const row of turnRows) {
        yield* sql`
          INSERT INTO projection_turns (
            thread_id, turn_id, pending_message_id, state, requested_at, started_at,
            completed_at, checkpoint_files_json
          )
          VALUES (${row.thread_id as string}, ${row.turn_id as string},
            ${row.pending_message_id as string | null}, ${row.state as string},
            ${row.requested_at as string}, ${row.started_at as string},
            ${row.completed_at as string}, ${row.checkpoint_files_json as string})
        `;
      }

      const olderPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 1,
        beforeCursor: cursor,
      });
      assert.equal(olderPage._tag, "Some");
      if (olderPage._tag === "Some") {
        // Identical older slice to what the pre-rewrite cursor would return.
        assert.deepEqual(messageIds(olderPage.value), [
          "turn-1-reply",
          "turn-2-reply",
          "turn-3-reply",
          "user-msg-1",
        ]);
        assert.equal(olderPage.value.page?.hasMore, false);
      }
    }),
  );

  it.effect("beforeCursor returns the disjoint adjacent older slice", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const firstPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(firstPage._tag, "Some");
      if (firstPage._tag !== "Some") return;
      const cursor = firstPage.value.page?.beforeCursor;
      assert.notEqual(cursor, null);
      assert.notEqual(cursor, undefined);
      if (cursor === null || cursor === undefined) return;

      // Older page: user turn-1 plus subagent turns 2-3 riding along. Disjoint
      // from the first page: no turn-4/5 rows, no straggler.
      const olderPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 1,
        beforeCursor: cursor,
      });
      assert.equal(olderPage._tag, "Some");
      if (olderPage._tag === "Some") {
        assert.deepEqual(messageIds(olderPage.value), [
          "turn-1-reply",
          "turn-2-reply",
          "turn-3-reply",
          "user-msg-1",
        ]);
        assert.deepEqual(activityIds(olderPage.value), [
          "turn-1-activity",
          "turn-2-activity",
          "turn-3-activity",
        ]);
        assert.equal(olderPage.value.page?.hasMore, false);
        assert.equal(olderPage.value.page?.beforeCursor, null);
      }
    }),
  );

  it.effect("a cursor for a different thread degrades to the first page", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const firstPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(firstPage._tag, "Some");
      if (firstPage._tag !== "Some") return;

      const foreign = encodeThreadDetailPageCursor({
        threadId: ThreadId.make("thread-other"),
        beforeAnchorAt: "2026-03-01T00:01:00.000Z",
        beforeTurnId: "turn-2",
      });
      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
        beforeCursor: foreign,
      });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.deepEqual(messageIds(snapshot.value), messageIds(firstPage.value));
      }
    }),
  );

  it.effect("a malformed cursor degrades to the first page instead of failing", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
        beforeCursor: "not-a-cursor",
      });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.page?.hasMore, true);
        assert.equal(snapshot.value.thread.messages.length, 5);
      }
    }),
  );

  it.effect("windows never split below the raw-turn ceiling boundary contiguously", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      // Page repeatedly with turnLimit 1 and assert the union of all pages is
      // exactly the full thread with no duplicates (disjointness + coverage).
      const seenMessages: string[] = [];
      const seenActivities: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
          turnLimit: 1,
          ...(cursor !== undefined ? { beforeCursor: cursor } : {}),
        });
        assert.equal(snapshot._tag, "Some");
        if (snapshot._tag !== "Some") return;
        seenMessages.push(...snapshot.value.thread.messages.map((message) => message.id));
        seenActivities.push(...snapshot.value.thread.activities.map((activity) => activity.id));
        const next = snapshot.value.page?.beforeCursor;
        if (next === null || next === undefined) break;
        cursor = next;
      }
      assert.equal(new Set(seenMessages).size, seenMessages.length);
      assert.equal(new Set(seenActivities).size, seenActivities.length);
      assert.equal(seenMessages.length, 9);
      assert.equal(seenActivities.length, 6);
    }),
  );

  // A helper's steps are many — one helper made 133 calls in 58 minutes — and
  // never crowd the Mate's own record out of a snapshot; each helper keeps its
  // latest steps on a budget of its own.
  it.effect("keeps the Mate's record whole beside its helpers' steps", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      // 400 rows of the Mate's own, then 2 × 300 rows of two helpers' steps.
      yield* sql`
        WITH RECURSIVE activity_rows(sequence) AS (
          SELECT 1
          UNION ALL
          SELECT sequence + 1 FROM activity_rows WHERE sequence < 1000
        )
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        SELECT
          printf('activity-%04d', sequence),
          'thread-w',
          'turn-5',
          'tool',
          CASE WHEN sequence % 2 = 0 THEN 'tool.completed' ELSE 'tool.started' END,
          'ran tool',
          CASE
            WHEN sequence <= 400 THEN json_object('itemType', 'command_execution')
            ELSE json_object(
              'itemType', 'command_execution',
              'agentId', CASE WHEN sequence % 4 < 2 THEN 'helper-a' ELSE 'helper-b' END,
              'parentToolUseId', 'toolu-parent'
            )
          END,
          sequence,
          '2026-03-01T00:04:00.000Z'
        FROM activity_rows
      `;
      yield* fillBudgetColumns();

      const reads = [
        yield* snapshotQuery.getThreadDetailSnapshot(threadW),
        yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 }),
      ];
      for (const read of reads) {
        assert.equal(read._tag, "Some");
        if (read._tag !== "Some") continue;
        const activities = read.value.thread.activities;
        const owner = (activity: (typeof activities)[number]) =>
          (activity.payload as { agentId?: string }).agentId ?? "mate";
        const count = (who: string) => activities.filter((activity) => owner(activity) === who);
        assert.equal(count("mate").length, 400);
        assert.equal(count("helper-a").length, 150);
        assert.equal(count("helper-b").length, 150);
        // Each helper's newest steps.
        assert.equal(count("helper-a").at(-1)?.id, asEventId("activity-1000"));
        assert.equal(count("helper-b").at(-1)?.id, asEventId("activity-0999"));
        // In the record's order.
        const sequences = activities.map((activity) => activity.sequence ?? 0);
        assert.deepStrictEqual(
          sequences,
          sequences.toSorted((left, right) => left - right),
        );
      }
    }),
  );

  it.effect("bounds activity hydration and preserves unresolved requests", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`
        WITH RECURSIVE activity_rows(sequence) AS (
          SELECT 1
          UNION ALL
          SELECT sequence + 1 FROM activity_rows WHERE sequence < 501
        )
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        SELECT
          printf('activity-%04d', sequence),
          'thread-w',
          'turn-5',
          'tool',
          CASE
            WHEN sequence = 2 THEN 'tool.updated'
            WHEN sequence IN (3, 70) THEN 'context-window.updated'
            ELSE 'tool.completed'
          END,
          'ran tool',
          CASE
            WHEN sequence IN (2, 80) THEN json_object(
              'itemType', 'command_execution',
              'toolCallId', 'cross-batch-call',
              'title', CASE WHEN sequence = 80 THEN 'Build completed' ELSE 'Build' END,
              'status', 'completed',
              'data', json_object(
                'toolCallId', 'cross-batch-call',
                'item', json_object(
                  'command', 'vp test run',
                  'aggregatedOutput', printf(
                    'command output%s%s',
                    char(10),
                    replace(hex(zeroblob(8192)), '00', 'x')
                  )
                ),
                'rawOutput', printf(
                  'raw output%s%s',
                  char(10),
                  replace(hex(zeroblob(8192)), '00', 'y')
                ),
                'files', json_array(json_object('path', 'apps/server/src/snapshot.ts'))
              )
            )
            WHEN sequence = 10 THEN json_object(
              'itemType', 'mcp_tool_call',
              'status', 'completed',
              'data', json_object(
                'item', json_object(
                  'type', 'mcpToolCall',
                  'id', 'mcp-item-10',
                  'tool', 'fetch_pr',
                  'server', 'github',
                  'status', 'completed',
                  'arguments', json_object('pr', 42),
                  'result', json_object(
                    'content', json_array(json_object(
                      'type', 'text',
                      'text', printf(
                        'PR body line one%s%s',
                        char(10),
                        replace(hex(zeroblob(8192)), '00', 'z')
                      )
                    ))
                  ),
                  '_meta', json_object('raw', replace(hex(zeroblob(8192)), '00', 'q'))
                )
              )
            )
            WHEN sequence = 11 THEN json_object(
              'itemType', 'command_execution',
              'status', 'completed',
              'data', json_object(
                'item', json_object(
                  'status', 'failed',
                  'command', 'vp test run',
                  'aggregatedOutput', printf(
                    'failed command%s%s',
                    char(10),
                    replace(hex(zeroblob(8192)), '00', 'w')
                  )
                ),
                'rawOutput', json_object('stdout', 'failed output'),
                'files', json_array(json_object('path', 'apps/server/src/failed.ts'))
              )
            )
            WHEN sequence IN (3, 70) THEN json_object(
              'usedTokens', sequence * 100,
              'modelContextWindow', 100000
            )
            ELSE json_object('sequence', sequence)
          END,
          sequence,
          '2026-03-01T00:04:00.000Z'
        FROM activity_rows
      `;
      yield* fillBudgetColumns();

      const fullDetail = yield* snapshotQuery.getThreadDetailById(threadW);
      assert.equal(fullDetail._tag, "Some");
      if (fullDetail._tag === "Some") {
        assert.equal(fullDetail.value.activities.length, 500);
        assert.equal(fullDetail.value.activities[0]?.id, asEventId("activity-0002"));
        assert.equal(fullDetail.value.activities.at(-1)?.id, asEventId("activity-0501"));
      }

      const windowedDetail = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
      });
      assert.equal(windowedDetail._tag, "Some");
      if (windowedDetail._tag === "Some") {
        // A page holds its turn whole; only the reading a later one supersedes
        // stays behind.
        const ids = windowedDetail.value.thread.activities.map((activity) => activity.id);
        assert.equal(ids.length, 500);
        assert.equal(ids[0], asEventId("activity-0001"));
        assert.equal(ids.at(-1), asEventId("activity-0501"));
        assert.equal(ids.includes(asEventId("activity-0003")), false);
      }

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        VALUES
          (
            'approval-old', 'thread-w', NULL, 'approval', 'approval.requested',
            'Approve old command', '{"requestId":"approval-1"}', NULL,
            '2026-03-01T00:00:01.000Z'
          ),
          (
            'user-input-old', 'thread-w', NULL, 'approval', 'user-input.requested',
            'Answer old question', '{"requestId":"input-1"}', NULL,
            '2026-03-01T00:00:02.000Z'
          ),
          (
            'user-input-closed', 'thread-w', NULL, 'approval', 'user-input.requested',
            'Closed question', '{"requestId":"input-closed"}', NULL,
            '2026-03-01T00:00:03.000Z'
          ),
          (
            'user-input-closed-resolution', 'thread-w', NULL, 'info', 'user-input.resolved',
            'Closed question', '{"requestId":"input-closed"}', NULL,
            '2026-03-01T00:00:04.000Z'
          ),
          (
            'user-input-tied-z-request', 'thread-w', NULL, 'approval', 'user-input.requested',
            'Tied open question', '{"requestId":"input-tied-open"}', NULL,
            '2026-03-01T00:00:05.000Z'
          ),
          (
            'user-input-tied-a-resolution', 'thread-w', NULL, 'info', 'user-input.resolved',
            'Tied open question', '{"requestId":"input-tied-open"}', NULL,
            '2026-03-01T00:00:05.000Z'
          )
      `;
      yield* sql`
        INSERT INTO projection_pending_approvals (
          request_id, thread_id, turn_id, status, decision, created_at, resolved_at
        )
        VALUES (
          'approval-1', 'thread-w', NULL, 'pending', NULL,
          '2026-03-01T00:00:01.000Z', NULL
        )
      `;
      yield* sql`
        UPDATE projection_threads
        SET pending_approval_count = 1, pending_user_input_count = 1
        WHERE thread_id = 'thread-w'
      `;

      const detailWithPinnedRequests = yield* snapshotQuery.getThreadDetailById(threadW);
      assert.equal(detailWithPinnedRequests._tag, "Some");
      if (detailWithPinnedRequests._tag === "Some") {
        const ids = new Set(
          detailWithPinnedRequests.value.activities.map((activity) => activity.id),
        );
        assert.equal(detailWithPinnedRequests.value.activities.length, 503);
        assert.equal(ids.has(asEventId("approval-old")), true);
        assert.equal(ids.has(asEventId("user-input-old")), true);
        assert.equal(ids.has(asEventId("user-input-closed")), false);
        assert.equal(ids.has(asEventId("user-input-tied-z-request")), true);
      }

      const windowWithPinnedRequests = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
      });
      assert.equal(windowWithPinnedRequests._tag, "Some");
      if (windowWithPinnedRequests._tag === "Some") {
        const ids = new Set(
          windowWithPinnedRequests.value.thread.activities.map((activity) => activity.id),
        );
        assert.equal(windowWithPinnedRequests.value.thread.activities.length, 503);
        assert.equal(ids.has(asEventId("approval-old")), true);
        assert.equal(ids.has(asEventId("user-input-old")), true);
        assert.equal(ids.has(asEventId("user-input-closed")), false);
        assert.equal(ids.has(asEventId("user-input-tied-z-request")), true);
      }

      const fullSnapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW);
      assert.equal(fullSnapshot._tag, "Some");
      if (
        detailWithPinnedRequests._tag === "Some" &&
        fullSnapshot._tag === "Some" &&
        windowWithPinnedRequests._tag === "Some"
      ) {
        const projectedFullSnapshot = projectThreadDetailSnapshot(fullSnapshot.value);
        const projectedRawBaseline = projectThreadDetailSnapshot({
          snapshotSequence: fullSnapshot.value.snapshotSequence,
          thread: detailWithPinnedRequests.value,
        });
        // The client's read reaches one row further back: the room the
        // superseded reading no longer takes.
        assert.deepStrictEqual(
          {
            ...projectedFullSnapshot,
            thread: {
              ...projectedFullSnapshot.thread,
              activities: projectedFullSnapshot.thread.activities.filter(
                (activity) => activity.id !== asEventId("activity-0001"),
              ),
            },
          },
          projectedRawBaseline,
        );

        const rawActivitiesById = new Map(
          detailWithPinnedRequests.value.activities.map((activity) => [activity.id, activity]),
        );
        const projectedWindowSnapshot = projectThreadDetailSnapshot(windowWithPinnedRequests.value);
        const projectedWindowBaseline = projectThreadDetailSnapshot({
          ...windowWithPinnedRequests.value,
          thread: {
            ...windowWithPinnedRequests.value.thread,
            activities: windowWithPinnedRequests.value.thread.activities.map(
              (activity) => rawActivitiesById.get(activity.id) ?? activity,
            ),
          },
        });
        assert.deepStrictEqual(projectedWindowSnapshot, projectedWindowBaseline);

        const projectedIds = new Set(
          projectedFullSnapshot.thread.activities.map((activity) => activity.id),
        );
        // The call's first sight, with no start before it: where its step starts.
        assert.equal(projectedIds.has(asEventId("activity-0002")), true);
        assert.equal(projectedIds.has(asEventId("activity-0003")), false);
        assert.equal(projectedIds.has(asEventId("activity-0070")), true);

        const failedCommand = projectedFullSnapshot.thread.activities.find(
          (activity) => activity.id === asEventId("activity-0011"),
        );
        assert.deepStrictEqual(failedCommand?.payload, {
          itemType: "command_execution",
          status: "failed",
          data: {
            item: {
              command: "vp test run",
              aggregatedOutput: "failed command",
            },
            files: [{ path: "apps/server/src/failed.ts" }],
            rawOutput: { content: "failed output" },
          },
        });
      }
    }),
  );

  it.effect("a thread with no turns returns its content unwindowed on the first page", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
        )
        VALUES ('project-e', 'Empty', '/tmp/project-e', '[]',
          '2026-03-02T00:00:00.000Z', '2026-03-02T00:00:00.000Z', NULL)
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
          created_at, updated_at, deleted_at
        )
        VALUES ('thread-e', 'project-e', 'Turnless thread',
          '{"provider":"codex","model":"gpt-5-codex"}', 'full-access', 'default',
          0, 0, 0, '2026-03-02T00:00:00.000Z', '2026-03-02T00:00:00.000Z', NULL)
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        )
        VALUES ('pre-turn-msg', 'thread-e', NULL, 'user', 'first prompt', 0,
          '2026-03-02T00:00:01.000Z', '2026-03-02T00:00:01.000Z')
      `;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
          VALUES (${projector}, 7, '2026-03-02T00:00:01.000Z')
        `;
      }

      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(ThreadId.make("thread-e"), {
        turnLimit: 5,
      });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.deepEqual(messageIds(snapshot.value), ["pre-turn-msg"]);
        assert.equal(snapshot.value.page?.hasMore, false);
        assert.equal(snapshot.value.page?.beforeCursor, null);
      }
    }),
  );
});

projectionSnapshotLayer("ProjectionSnapshotQuery a long conversation's history", (it) => {
  // A long run shaped like a real one: 28 asks, most with a handful of calls,
  // two with forty; every third sends two helpers, whose results land in a
  // turn of their own — one of them after the next ask. Each call streams an
  // update and a context reading, and the turnless meter reads four times
  // between calls: ~1,950 rows, 60% of them readings and updates a later row
  // supersedes. A helper's progress is one row, updated in place as ingestion
  // stores it; `legacyTicks` stores forty, as rows stored before that did.
  // No row carries a sequence, as none does live.
  const threadL = ThreadId.make("thread-l");
  const ASKS = 28;

  interface Card {
    readonly userMessageId: string;
    readonly steps: Set<string>;
  }

  const seedLongThread = Effect.fnUntraced(function* (
    options: { readonly callsPerAsk?: number; readonly legacyTicks?: boolean } = {},
  ) {
    const { callsPerAsk, legacyTicks = false } = options;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM projection_projects`;
    yield* sql`DELETE FROM projection_threads`;
    yield* sql`DELETE FROM projection_turns`;
    yield* sql`DELETE FROM projection_thread_messages`;
    yield* sql`DELETE FROM projection_thread_activities`;
    yield* sql`DELETE FROM projection_state`;
    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
      )
      VALUES ('project-l', 'Long', '/tmp/project-l', '[]',
        '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', NULL)
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
        created_at, updated_at, deleted_at
      )
      VALUES ('thread-l', 'project-l', 'Long thread',
        '{"provider":"claudeAgent","model":"claude-opus"}', 'full-access', 'default',
        0, 0, 0, '2026-05-01T00:00:00.000Z', '2026-05-01T05:00:00.000Z', NULL)
    `;

    let sequence = 0;
    const pad = (value: number) => String(value).padStart(2, "0");
    // Seconds into the day the conversation runs.
    const at = (seconds: number) =>
      `2026-05-01T${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.000Z`;
    const turns: Array<Record<string, unknown>> = [];
    const messages: Array<Record<string, unknown>> = [];
    const activities: Array<Record<string, unknown>> = [];
    const cards: Card[] = [];
    const activity = (
      id: string,
      turnId: string | null,
      kind: string,
      seconds: number,
      payload: Record<string, unknown>,
    ) => {
      sequence += 1;
      activities.push({
        activity_id: id,
        thread_id: "thread-l",
        turn_id: turnId,
        tone: "tool",
        kind,
        summary: kind,
        payload_json: JSON.stringify(payload),
        sequence: null,
        created_at: at(seconds),
        ...budgetColumnsOf(kind, payload),
      });
      return id;
    };
    const turn = (turnId: string, pendingMessageId: string | null, seconds: number) =>
      turns.push({
        thread_id: "thread-l",
        turn_id: turnId,
        pending_message_id: pendingMessageId,
        state: "completed",
        requested_at: at(seconds),
        started_at: at(seconds),
        completed_at: at(seconds + 590),
        checkpoint_files_json: "[]",
      });
    const message = (id: string, turnId: string | null, role: string, seconds: number) =>
      messages.push({
        message_id: id,
        thread_id: "thread-l",
        turn_id: turnId,
        role,
        text: `${role} text`,
        is_streaming: 0,
        created_at: at(seconds),
        updated_at: at(seconds),
      });

    const lateResults: Array<{ helper: string; card: Card }> = [];
    for (let ask = 0; ask < ASKS; ask += 1) {
      const base = ask * 600;
      const turnId = `turn-${ask}`;
      const card: Card = { userMessageId: `ask-${ask}`, steps: new Set() };
      cards.push(card);
      message(card.userMessageId, null, "user", base);
      turn(turnId, card.userMessageId, base);
      const calls = callsPerAsk ?? (ask === 4 || ask === 19 ? 40 : 6);
      for (let call = 0; call < calls; call += 1) {
        const seconds = base + 1 + call * 10;
        const toolCallId = `call-${ask}-${call}`;
        card.steps.add(
          activity(`${toolCallId}-start`, turnId, "tool.started", seconds, { toolCallId }),
        );
        activity(`${toolCallId}-update`, turnId, "tool.updated", seconds + 1, { toolCallId });
        card.steps.add(
          activity(`${toolCallId}-done`, turnId, "tool.completed", seconds + 2, { toolCallId }),
        );
        activity(`${toolCallId}-usage`, turnId, "context-window.updated", seconds + 3, {
          usedTokens: 1_000 * (call + 1),
        });
        for (let reading = 0; reading < 4; reading += 1) {
          activity(
            `${toolCallId}-meter-${reading}`,
            null,
            "context-window.updated",
            seconds + 4 + reading,
            {
              usedTokens: 2_000 * (call + 1) + reading,
            },
          );
        }
      }
      message(`${turnId}-reply`, turnId, "assistant", base + 500);
      if (ask % 3 !== 0) continue;
      const resultsTurn = `${turnId}-results`;
      turn(resultsTurn, null, base + 520);
      for (const helper of ["a", "b"]) {
        const taskId = `task-${ask}-${helper}`;
        card.steps.add(
          activity(`${taskId}-start`, turnId, "task.started", base + 450, {
            taskId,
            agentKind: "agent",
          }),
        );
        if (legacyTicks) {
          for (let tick = 0; tick < 40; tick += 1) {
            activity(`${taskId}-tick-${tick}`, null, "task.progress", base + 451 + tick, {
              taskId,
              summary: `tick ${tick}`,
            });
          }
        } else {
          activity(`${taskId}-progress`, null, "task.progress", base + 490, {
            taskId,
            summary: "tick 39",
          });
        }
        if (helper === "b" && ask + 1 < ASKS) {
          lateResults.push({ helper: taskId, card });
          continue;
        }
        card.steps.add(
          activity(`${taskId}-done`, resultsTurn, "task.completed", base + 521, { taskId }),
        );
      }
    }
    // A helper sent in one ask reports after the next one: its result is a
    // turn of its own, in the later ask's group.
    for (const { helper } of lateResults) {
      const ask = Number(helper.split("-")[1]) + 1;
      const resultsTurn = `${helper}-late`;
      turn(resultsTurn, null, ask * 600 + 540);
      activity(`${helper}-done`, resultsTurn, "task.completed", ask * 600 + 541, {
        taskId: helper,
      });
    }

    const insertChunks = (table: string, rows: ReadonlyArray<Record<string, unknown>>) =>
      Effect.forEach(
        Arr.chunksOf(rows, 200),
        (chunk) => sql`INSERT INTO ${sql(table)} ${sql.insert(chunk)}`,
      );
    yield* insertChunks("projection_turns", turns);
    yield* insertChunks("projection_thread_messages", messages);
    yield* insertChunks("projection_thread_activities", activities);
    for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
      yield* sql`
        INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
        VALUES (${projector}, ${sequence}, '2026-05-01T05:00:00.000Z')
      `;
    }
    return { cards, activityCount: activities.length };
  });

  // Every page the client reads walking back: the first of 10 asks, then 20
  // at a time, as `threads.ts` asks for them.
  const readEveryPage = Effect.fnUntraced(function* () {
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const pages: Array<{ messages: Set<string>; activities: Set<string> }> = [];
    let beforeCursor: string | undefined;
    for (let read = 0; read < 50; read += 1) {
      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadL, {
        turnLimit: read === 0 ? 10 : 20,
        ...(beforeCursor === undefined ? {} : { beforeCursor }),
      });
      if (snapshot._tag !== "Some") break;
      pages.push({
        messages: new Set(snapshot.value.thread.messages.map((entry) => entry.id)),
        activities: new Set(snapshot.value.thread.activities.map((entry) => entry.id)),
      });
      const cursor = snapshot.value.page?.beforeCursor;
      if (cursor === null || cursor === undefined) break;
      beforeCursor = cursor;
    }
    return pages;
  });

  it.effect("every card keeps all its steps on the page that shows it", () =>
    Effect.gen(function* () {
      const { cards, activityCount } = yield* seedLongThread();
      assert.isAbove(activityCount, 1_900);
      const pages = yield* readEveryPage();

      const wholeCards = cards.filter((card) => {
        const page = pages.find((candidate) => candidate.messages.has(card.userMessageId));
        return page !== undefined && [...card.steps].every((step) => page.activities.has(step));
      });
      assert.equal(wholeCards.length, ASKS);
      // The newest page still opens on several asks, not one.
      const firstPageAsks = cards.filter((card) => pages[0]?.messages.has(card.userMessageId));
      assert.isAtLeast(firstPageAsks.length, 8);
    }),
  );

  it.effect("a page too long for its asks holds fewer, each whole", () =>
    Effect.gen(function* () {
      // Fifty calls an ask: ten asks hold more steps than a page carries.
      const { cards } = yield* seedLongThread({ callsPerAsk: 50 });
      const pages = yield* readEveryPage();
      const asksOn = (page: (typeof pages)[number]) =>
        cards.filter((card) => page.messages.has(card.userMessageId));

      const firstPageAsks = asksOn(pages[0]!);
      assert.isAbove(firstPageAsks.length, 1);
      assert.isBelow(firstPageAsks.length, 10);
      // Every ask on exactly one page, every page's asks whole.
      assert.deepEqual(
        pages
          .flatMap(asksOn)
          .map((card) => card.userMessageId)
          .toSorted(),
        cards.map((card) => card.userMessageId).toSorted(),
      );
      for (const page of pages) {
        for (const card of asksOn(page)) {
          for (const step of card.steps) assert.isTrue(page.activities.has(step), step);
        }
      }
    }),
  );

  it.effect("a helper's result keeps the start that sent it on its page", () =>
    Effect.gen(function* () {
      yield* seedLongThread({ callsPerAsk: 50 });
      const pages = yield* readEveryPage();
      let resultsAfterTheirAsk = 0;
      for (const page of pages) {
        for (const id of page.activities) {
          if (!id.startsWith("task-") || !id.endsWith("-done")) continue;
          const start = id.replace(/-done$/u, "-start");
          assert.isTrue(page.activities.has(start), `${start} beside ${id}`);
          const ask = id.split("-")[1];
          if (!page.messages.has(`ask-${ask}`)) resultsAfterTheirAsk += 1;
        }
      }
      // The page edge falls between an ask and the result it sent.
      assert.isAbove(resultsAfterTheirAsk, 0);
    }),
  );

  it.effect("a superseded reading or tick takes no step's place", () =>
    Effect.gen(function* () {
      yield* seedLongThread({ legacyTicks: true });
      const [first] = yield* readEveryPage();
      const ids = [...(first?.activities ?? [])];
      // A helper's first tick and its latest six; each turn's latest reading;
      // no update its completion supersedes.
      const ticks = ids.filter((id) => id.startsWith("task-27-a-tick-"));
      assert.deepEqual(
        ticks.toSorted(),
        ["0", "34", "35", "36", "37", "38", "39"]
          .map((tick) => `task-27-a-tick-${tick}`)
          .toSorted(),
      );
      assert.deepEqual(
        ids.filter((id) => id.startsWith("call-27-") && id.endsWith("-usage")),
        ["call-27-5-usage"],
      );
      assert.equal(
        ids.some((id) => id.endsWith("-update")),
        false,
      );
    }),
  );
});
