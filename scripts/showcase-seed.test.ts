// @effect-diagnostics nodeBuiltinImport:off - This host-side test exercises an isolated SQLite projection.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import { loadShowcaseScene } from "@t3tools/shared/showcaseScenes";

import {
  mobileShowcaseScene,
  seedMobileShowcaseDatabase,
  SHOWCASE_THREADS,
} from "./mobile-showcase-environment.ts";
import { seedShowcaseScene } from "./showcase-seed.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const REPO_ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

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

async function runServerMigrations(dbPath: string): Promise<void> {
  const effectModuleUrl = NodeURL.pathToFileURL(
    NodeModule.createRequire(import.meta.url).resolve("effect/Effect"),
  ).href;
  const migrationsModuleUrl = NodeURL.pathToFileURL(
    NodePath.join(REPO_ROOT, "apps/server/src/persistence/Migrations.ts"),
  ).href;
  const sqliteClientModuleUrl = NodeURL.pathToFileURL(
    NodePath.join(REPO_ROOT, "apps/server/src/persistence/NodeSqliteClient.ts"),
  ).href;
  await execFile(
    NodeProcess.execPath,
    [
      "--input-type=module",
      "--eval",
      `import * as Effect from ${JSON.stringify(effectModuleUrl)};
import { runMigrations } from ${JSON.stringify(migrationsModuleUrl)};
import * as NodeSqliteClient from ${JSON.stringify(sqliteClientModuleUrl)};
await Effect.runPromise(
  runMigrations().pipe(Effect.provide(NodeSqliteClient.layer({ filename: process.argv[1] }))),
);`,
      dbPath,
    ],
    { cwd: REPO_ROOT },
  );
}

async function createSeedableDatabase(baseDir: string): Promise<string> {
  const userDataDirectory = NodePath.join(baseDir, "userdata");
  await NodeFSP.mkdir(userDataDirectory, { recursive: true });
  const dbPath = NodePath.join(userDataDirectory, "state.sqlite");
  await runServerMigrations(dbPath);
  return dbPath;
}

it("seeds the web cards scene as a complete projection snapshot", async () => {
  const baseDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "showcase-seed-"));
  try {
    const dbPath = await createSeedableDatabase(baseDir);
    const cardsScene = loadShowcaseScene("web:cards");
    const scene = {
      ...cardsScene,
      threads: cardsScene.threads.map((thread) => ({
        ...thread,
        session: {
          threadId: thread.id,
          status: "ready" as const,
          providerName: "Claude Code",
          providerInstanceId: ProviderInstanceId.make("claude-code"),
          runtimeMode: thread.runtimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: thread.updatedAt,
        },
      })),
    };

    await seedShowcaseScene({ baseDir, scene, now: Date.parse("2026-08-30T12:30:00.000Z") });

    const database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const activities = database
        .prepare(
          "SELECT activity_id, thread_id, turn_id, payload_json, sequence FROM projection_thread_activities ORDER BY thread_id, sequence, activity_id",
        )
        .all() as Array<{
        activity_id: string;
        thread_id: string;
        turn_id: string | null;
        payload_json: string;
        sequence: number;
      }>;
      const expectedActivities = Object.entries(scene.threadActivities).flatMap(
        ([threadId, threadActivities]) =>
          threadActivities.map((activity, index) => ({ threadId, activity, index })),
      );
      assert.equal(activities.length, expectedActivities.length);
      for (const [index, row] of activities.entries()) {
        const expected = expectedActivities[index];
        assert.ok(expected);
        assert.equal(row.activity_id, expected.activity.id);
        assert.equal(row.thread_id, expected.threadId);
        assert.equal(row.turn_id, expected.activity.turnId);
        assert.deepStrictEqual(JSON.parse(row.payload_json), expected.activity.payload);
        assert.equal(row.sequence, expected.activity.sequence ?? expected.index);
      }
      assert.equal(
        activities.some((row) => {
          const payload = JSON.parse(row.payload_json) as {
            readonly data?: { readonly zerops?: unknown };
          };
          return payload.data?.zerops !== undefined;
        }),
        true,
      );

      assert.deepStrictEqual(
        database
          .prepare("SELECT thread_id FROM projection_threads ORDER BY thread_id")
          .all()
          .map((row) => (row as { thread_id: string }).thread_id),
        scene.threads.map((thread) => thread.id).sort(),
      );

      const expectedTurnIds = new Set(
        scene.threads.flatMap((thread) => [
          ...(thread.latestTurn === null ? [] : [thread.latestTurn.turnId]),
          ...(scene.threadActivities[thread.id] ?? []).flatMap((activity) =>
            activity.turnId === null ? [] : [activity.turnId],
          ),
        ]),
      );
      const turns = database.prepare("SELECT thread_id, turn_id FROM projection_turns").all();
      assert.equal(turns.length, expectedTurnIds.size);

      const sessions = database
        .prepare(
          "SELECT thread_id, provider_name, provider_instance_id FROM projection_thread_sessions",
        )
        .all() as Array<{
        thread_id: string;
        provider_name: string | null;
        provider_instance_id: string | null;
      }>;
      assert.equal(
        sessions.length,
        scene.threads.filter((thread) => thread.session !== null).length,
      );
      const sceneThread = scene.threads[0];
      assert.ok(sceneThread);
      assert.deepStrictEqual(sessions, [
        {
          thread_id: sceneThread.id,
          provider_name: "Claude Code",
          provider_instance_id: "claude-code",
        },
      ]);

      assert.deepStrictEqual(
        database
          .prepare("SELECT projector FROM projection_state ORDER BY projector")
          .all()
          .map((row) => (row as { projector: string }).projector),
        [...PROJECTOR_NAMES].sort(),
      );
      assert.deepStrictEqual(
        database
          .prepare("SELECT DISTINCT updated_at FROM projection_state")
          .all()
          .map((row) => (row as { readonly updated_at: string }).updated_at),
        ["2026-08-30T12:29:00.000Z"],
      );
    } finally {
      database.close();
    }
  } finally {
    await NodeFSP.rm(baseDir, { recursive: true, force: true });
  }
});

it("keeps mobile project favicons null when the scene carries none", async () => {
  const baseDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "showcase-seed-favicon-"));
  try {
    const dbPath = await createSeedableDatabase(baseDir);
    const scene = mobileShowcaseScene({ projectIds: ["t3code"] });
    assert.equal("faviconPath" in scene.projects[0]!, false);

    await seedShowcaseScene({ baseDir, scene, now: Date.parse("2026-08-30T12:30:00.000Z") });

    const database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const project = database
        .prepare("SELECT favicon_path FROM projection_projects WHERE project_id = ?")
        .get("t3code") as { readonly favicon_path: string | null };
      assert.equal(project.favicon_path, null);
    } finally {
      database.close();
    }
  } finally {
    await NodeFSP.rm(baseDir, { recursive: true, force: true });
  }
});

it("keeps mobile projections and messages in one immediate transaction", async () => {
  const baseDir = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "showcase-seed-transaction-"),
  );
  try {
    const dbPath = await createSeedableDatabase(baseDir);
    const database = new NodeSqlite.DatabaseSync(dbPath);
    const statements: Array<string> = [];
    const tracedDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "exec") {
          return (sql: string) => {
            statements.push(sql);
            return target.exec(sql);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const now = Date.parse("2026-08-30T12:30:00.000Z");
    try {
      seedMobileShowcaseDatabase({
        database: tracedDatabase,
        scene: mobileShowcaseScene({ projectIds: ["t3code"], now }),
        threads: SHOWCASE_THREADS.filter((thread) => thread.projectId === "t3code"),
        now,
      });
      assert.deepStrictEqual(
        statements.filter((statement) => statement === "BEGIN IMMEDIATE"),
        ["BEGIN IMMEDIATE"],
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS count FROM projection_thread_messages").get()!.count,
        6,
      );
    } finally {
      database.close();
    }
  } finally {
    await NodeFSP.rm(baseDir, { recursive: true, force: true });
  }
});
