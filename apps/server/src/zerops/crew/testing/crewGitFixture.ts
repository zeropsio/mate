// @effect-diagnostics nodeBuiltinImport:off
/**
 * A dev service for crew tests: a temporary repository that stands in for
 * `remotePath` (and `mountPath`), reached through the local ssh shim with the
 * project and service ids injected, so every crew script runs as it would on
 * the service - identity guard included.
 *
 * @module crewGitFixture
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { localSshProcessRunnerLayer } from "../../testing/localSsh.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../../ZeropsRepositorySource.ts";
import * as CrewChecks from "../CrewChecks.ts";
import * as CrewShell from "../CrewShell.ts";
import * as CrewStore from "../CrewStore.ts";
import * as CrewWorkspace from "../CrewWorkspace.ts";

export const TEST_HOST = "appdev";
export const TEST_IDENTITY = { projectId: "project-crew", serviceId: "service-appdev" } as const;

const PERSON = {
  GIT_AUTHOR_NAME: "Person",
  GIT_AUTHOR_EMAIL: "person@example.com",
  GIT_COMMITTER_NAME: "Person",
  GIT_COMMITTER_EMAIL: "person@example.com",
};

/** Git as the person, in `cwd` - how a test arranges or inspects the service's repository. */
export const git = (cwd: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync("git", [...args], {
    cwd,
    env: { ...process.env, ...PERSON },
    encoding: "utf8",
  }).trim();

/** Git as the person, for a command expected to fail (a conflicting merge); its exit code. */
export const gitExit = (cwd: string, args: ReadonlyArray<string>): number | null =>
  NodeChildProcess.spawnSync("git", [...args], {
    cwd,
    env: { ...process.env, ...PERSON },
    stdio: "ignore",
  }).status;

export const write = (root: string, path: string, content: string): void => {
  const target = NodePath.join(root, path);
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  NodeFS.writeFileSync(target, content);
};

export const read = (root: string, path: string): string =>
  NodeFS.readFileSync(NodePath.join(root, path), "utf8");

export const exists = (root: string, path: string): boolean =>
  NodeFS.existsSync(NodePath.join(root, path));

/** A repository on `main` with one commit (`README.md`), as `/var/www` on a dev service. */
export const makeServiceRepository = (): string => {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-crew-service-")),
  );
  git(root, ["init", "-q", "-b", "main"]);
  write(root, "README.md", "service\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
};

export const removeServiceRepository = (root: string): void =>
  NodeFS.rmSync(root, { recursive: true, force: true });

export const serviceRepository = (root: string): ZeropsRepository => ({
  host: TEST_HOST,
  mountPath: root,
  remotePath: root,
  identity: TEST_IDENTITY,
});

const repositorySource = (repositories: ReadonlyArray<ZeropsRepository>) =>
  Layer.succeed(
    ZeropsRepositorySource,
    ZeropsRepositorySource.of({
      list: Effect.succeed({ _tag: "available", repositories }),
      refresh: Effect.succeed({ _tag: "available", repositories }),
      known: Effect.succeed(repositories),
      remember: () => Effect.void,
    }),
  );

export interface CrewShellFixtureOptions {
  /** What the far side's login shell carries; defaults to the fixture's identity. */
  readonly remoteEnv?: Readonly<Record<string, string>>;
}

/** `CrewShell` against `repositories` over the local shim, plus the platform services. */
export const crewShellLayer = (
  repositories: ReadonlyArray<ZeropsRepository>,
  options: CrewShellFixtureOptions = {},
) =>
  CrewShell.layer.pipe(
    Layer.provide(repositorySource(repositories)),
    Layer.provide(localSshProcessRunnerLayer(options.remoteEnv ?? TEST_IDENTITY)),
    Layer.provideMerge(NodeServices.layer),
  );

/** A writer on the fixture's host, lane = handle. */
export const memberRow = (handle: string, crew = "game"): CrewStore.CrewMemberRow => ({
  crew,
  handle,
  displayName: handle,
  kind: "writer",
  tint: null,
  host: TEST_HOST,
  lane: handle,
  readOnly: false,
  login: null,
  model: null,
  effort: null,
  jobVersion: 1,
  runCommand: null,
  restartAfterMerge: false,
  crewPort: null,
  config: {},
});

/** A task `#number` owned by `member`, landed when `landedCommit` is set. */
export const taskRow = (
  assignment: string,
  number: number,
  member: string,
  landedCommit: string | null = null,
): CrewStore.CrewAssignmentRow => ({
  assignment,
  run: null,
  crew: "game",
  member,
  number,
  title: `Task ${number}`,
  source: "you",
  createdBy: "user-1",
  card: null,
  pending: null,
  dependsOn: [],
  fresh: false,
  state: landedCommit === null ? "working" : "landed",
  attempt: 1,
  reworks: 0,
  remerges: 0,
  mergedHead: null,
  check: null,
  review: null,
  report: null,
  waiting: null,
  landedCommit,
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: `2026-09-27T10:${String(number).padStart(2, "0")}:00.000Z`,
});

/** A fresh in-memory crew database. */
export const crewStoreLayer = CrewStore.layer.pipe(
  Layer.provideMerge(
    Layer.effectDiscard(runMigrations()).pipe(
      Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    ),
  ),
);

/** The crew git core against one service repository, with its own database. */
export const crewGitLayer = (root: string, options: CrewShellFixtureOptions = {}) => {
  const shell = crewShellLayer([serviceRepository(root)], options);
  const checks = CrewChecks.layer.pipe(Layer.provideMerge(shell));
  return CrewWorkspace.layer.pipe(Layer.provideMerge(checks), Layer.provideMerge(crewStoreLayer));
};

/** Runs `body` against a fresh service repository, removed afterwards. */
export const withCrewService = <A, E, R, LE>(
  body: (root: string) => Effect.Effect<A, E, R>,
  layer: (root: string) => Layer.Layer<R, LE>,
) =>
  Effect.gen(function* () {
    const root = makeServiceRepository();
    return yield* body(root).pipe(
      Effect.provide(layer(root)),
      Effect.ensuring(Effect.sync(() => removeServiceRepository(root))),
    );
  });
