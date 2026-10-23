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
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { testTempDir } from "../../../testing/testTempDir.ts";
import { localSshProcessRunnerLayer } from "../../testing/localSsh.ts";
import { ZeropsRepositorySource, type ZeropsRepository } from "../../ZeropsRepositorySource.ts";
import { shellQuote } from "../../ZeropsWorkspaceAccess.ts";
import * as CrewApp from "../CrewApp.ts";
import * as CrewChecks from "../CrewChecks.ts";
import * as CrewIntegration from "../CrewIntegration.ts";
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

/**
 * A repository on `main` with one commit (`README.md`), as `/var/www` on a dev service; gone when
 * its test ends.
 */
export const makeServiceRepository = (): string => {
  const root = NodeFS.realpathSync(testTempDir("t3-crew-service-"));
  git(root, ["init", "-q", "-b", "main"]);
  write(root, "README.md", "service\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  return root;
};

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

/**
 * A stand-in for the dev service's supervisor `zcp-devsup` (spec-mate §2.8a.2), enough for crew
 * apps and Show on dev: `ctl --json run|rm|start|stop|status`, its entries in
 * `.git/devsup/state.json` of the repository it is asked from (the service's repo root, as the
 * real one runs in it), every call's arguments appended to `.git/devsup/calls.jsonl`. The servers
 * `.zcp/dev-servers.json` declares are its `declared` entries, stopped until `start`; `run` adds a
 * `runtime` one. Either starts its command with `/bin/sh -c` in its `cwd` as the leader of its own
 * process group — unless it already runs as asked — and `rm`/`stop` stop that group, TERM then
 * KILL. `status` answers every entry, or the one named. With `.git/devsup/down` present it answers
 * as a supervisor that is not running (exit 2).
 */
const FAKE_SUPERVISOR = `
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const dir = path.join(process.cwd(), ".git", "devsup");
fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify(args) + "\\n");
const answer = (code, value) => { process.stdout.write(JSON.stringify(value) + "\\n"); process.exit(code); };
if (fs.existsSync(path.join(dir, "down"))) answer(2, { code: 2, error: "no supervisor" });
const statePath = path.join(dir, "state.json");
const entries = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const declarationPath = path.join(process.cwd(), ".zcp", "dev-servers.json");
const declared = fs.existsSync(declarationPath)
  ? JSON.parse(fs.readFileSync(declarationPath, "utf8")).servers : [];
for (const server of declared) {
  entries[server.name] ??= { source: "declared", command: server.command, cwd: server.cwd ?? ".", port: server.port ?? 0, pid: 0 };
}
const alive = (pid) => { if (!pid) return false; try { process.kill(-pid, 0); return true; } catch { return false; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const shown = (e) => e.source === "declared"
  ? { source: "declared", status: alive(e.pid) ? "running" : "stopped", pid: alive(e.pid) ? e.pid : 0 }
  : { source: "runtime", status: alive(e.pid) ? "running" : "crashed", pid: alive(e.pid) ? e.pid : 0,
      command: e.command, cwd: e.cwd, port: e.port };
const state = (only) => ({ servers: Object.fromEntries(Object.entries(entries)
  .filter(([name]) => only === undefined || name === only).map(([name, e]) => [name, shown(e)])) });
const save = () => fs.writeFileSync(statePath, JSON.stringify(entries));
const stopGroup = (pid) => {
  if (!pid) return;
  try { process.kill(-pid, "SIGTERM"); } catch {}
  for (let n = 0; n < 50 && alive(pid); n++) sleep(100);
  try { process.kill(-pid, "SIGKILL"); } catch {}
};
const startEntry = (name, entry) => {
  const log = fs.openSync(path.join(dir, "logs", name + ".log"), "a");
  const child = spawn("/bin/sh", ["-c", entry.command], {
    cwd: path.join(process.cwd(), entry.cwd), detached: true, stdio: ["ignore", log, log],
  });
  child.unref();
  entries[name] = { ...entry, pid: child.pid };
  save();
};
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const dash = args.indexOf("--");
const words = (dash === -1 ? args : args.slice(0, dash)).filter((a, i, all) =>
  !a.startsWith("--") && !["--name", "--cwd", "--port"].includes(all[i - 1]));
const [ctl, verb, name] = words;
if (ctl !== "ctl" || !args.includes("--json")) answer(1, { code: 1, error: "usage" });
if (verb === "run") {
  const spec = { source: "runtime", command: args.slice(dash + 1).join(" "), cwd: flag("--cwd") ?? ".", port: Number(flag("--port") ?? 0) };
  const name = flag("--name");
  const old = entries[name];
  const same = old && old.command === spec.command && old.cwd === spec.cwd && old.port === spec.port;
  if (old && alive(old.pid) && !same) stopGroup(old.pid);
  if (!(old && alive(old.pid) && same)) startEntry(name, spec);
  answer(0, state());
}
if (verb === "status" && name === undefined) answer(0, state());
if (!entries[name]) answer(3, { code: 3, error: "unknown server " + name });
if (verb === "rm") { stopGroup(entries[name].pid); delete entries[name]; save(); answer(0, state()); }
if (verb === "stop") { stopGroup(entries[name].pid); entries[name].pid = 0; save(); answer(0, state()); }
if (verb === "start") { if (!alive(entries[name].pid)) startEntry(name, entries[name]); answer(0, state()); }
if (verb === "status") answer(0, state(name));
answer(1, { code: 1, error: "unknown verb " + verb });
`;

/**
 * The far side's environment with a `setsid` on its PATH. Linux services have
 * util-linux's; where this machine lacks one, a perl stand-in does the same
 * `setsid(2)` and exec.
 */
export const remoteEnvWithSetsid = (): Readonly<Record<string, string>> => {
  const found = NodeChildProcess.spawnSync("sh", ["-c", "command -v setsid"]).status === 0;
  if (found) return TEST_IDENTITY;
  const bin = testTempDir("t3-crew-bin-");
  NodeFS.writeFileSync(
    NodePath.join(bin, "setsid"),
    '#!/bin/sh\nexec perl -MPOSIX -e \'POSIX::setsid() or die "setsid: $!"; exec @ARGV or die "exec: $!"\' -- "$@"\n',
    { mode: 0o755 },
  );
  return { ...TEST_IDENTITY, PATH: `${bin}:${process.env.PATH ?? ""}` };
};

/**
 * The far side's environment with the fake supervisor as `zcp-devsup` on its PATH
 * ({@link FAKE_SUPERVISOR}), and a `setsid` for a supervisor that does not answer.
 */
export const remoteEnvWithSupervisor = (): Readonly<Record<string, string>> => {
  const bin = testTempDir("t3-crew-bin-");
  NodeFS.writeFileSync(NodePath.join(bin, "zcp-devsup.cjs"), FAKE_SUPERVISOR);
  NodeFS.writeFileSync(
    NodePath.join(bin, "zcp-devsup"),
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(NodePath.join(bin, "zcp-devsup.cjs"))} "$@"\n`,
    { mode: 0o755 },
  );
  const path = remoteEnvWithSetsid().PATH ?? process.env.PATH ?? "";
  return { ...TEST_IDENTITY, PATH: `${bin}:${path}` };
};

/** The fake supervisor's runtime entries in the service repository at `root`. */
export const supervisedApps = (
  root: string,
): Readonly<
  Record<
    string,
    { readonly command: string; readonly cwd: string; readonly port: number; readonly pid: number }
  >
> =>
  exists(root, ".git/devsup/state.json") ? JSON.parse(read(root, ".git/devsup/state.json")) : {};

/** Every `zcp-devsup` call made on the service repository at `root`, its arguments in order. */
export const supervisorCalls = (root: string): ReadonlyArray<ReadonlyArray<string>> =>
  exists(root, ".git/devsup/calls.jsonl")
    ? read(root, ".git/devsup/calls.jsonl")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as ReadonlyArray<string>)
    : [];

/** A dev server `.zcp/dev-servers.json` declares, as zcp writes it (spec-mate §2.8a.1). */
export interface DeclaredDevServer {
  readonly name: string;
  readonly port: number;
  readonly command: string;
  readonly cwd?: string;
}

/** The repository at `root` declares `servers`, on the dev setup's main port `port` first. */
export const declareDevServers = (
  root: string,
  servers: ReadonlyArray<DeclaredDevServer>,
): void => {
  NodeFS.mkdirSync(NodePath.join(root, ".zcp"), { recursive: true });
  write(root, ".zcp/dev-servers.json", JSON.stringify({ version: 1, servers }));
  write(
    root,
    "zerops.yaml",
    `zerops:\n  - setup: ${TEST_HOST}\n    run:\n      ports:\n${servers
      .map((server) => `        - port: ${server.port}\n          httpSupport: true\n`)
      .join("")}`,
  );
};

/** `zcp-devsup ctl --json <args>` on the service at `root`, as zcp or the person runs it. */
export const supervise = (root: string, ...args: ReadonlyArray<string>): void => {
  NodeChildProcess.execFileSync("zcp-devsup", ["ctl", "--json", ...args], {
    cwd: root,
    env: { ...process.env, ...remoteEnvWithSupervisor() },
    stdio: "ignore",
  });
};

/**
 * zcp deploys the service at `root` from itself: before `zcli push` it runs the crew's save when the
 * Mate wrote one, and a failing save stops the push.
 */
export const zcpDeploys = (root: string): void => {
  NodeChildProcess.execFileSync(
    "sh",
    ["-c", 'save="$(git rev-parse --git-common-dir)/t3-crew-save"; [ ! -x "$save" ] || "$save"'],
    { cwd: root, env: { ...process.env, ...PERSON }, stdio: "ignore" },
  );
};

/** The fixture's dev server: `web`, declared on the dev setup's main port. */
export const DEV_SERVER = { name: "web", port: 3000, command: "sleep 30" } as const;

/**
 * The supervisor at `root` serves dev from `from`: the declared {@link DEV_SERVER} from your
 * tree, or a crewmate's copy in its place, as a granted claim's turn leaves it.
 */
export const serveDev = (root: string, from: "tree" | { readonly handle: string }): void => {
  declareDevServers(root, [DEV_SERVER]);
  if (from === "tree") {
    supervise(root, "start", DEV_SERVER.name);
    return;
  }
  supervise(root, "stop", DEV_SERVER.name);
  supervise(
    root,
    "run",
    "--name",
    `show-${from.handle}`,
    "--cwd",
    `.crew/${from.handle}`,
    "--port",
    String(DEV_SERVER.port),
    "--",
    DEV_SERVER.command,
  );
};

/** Ends every process group the fake supervisor at `root` started. */
export const stopSupervised = (root: string): void => {
  for (const entry of Object.values(supervisedApps(root))) {
    if (entry.pid > 0) {
      try {
        process.kill(-entry.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
};

/** The service's supervisor stops answering, as one that is not running. */
export const supervisorDown = (root: string): void => {
  write(root, ".git/devsup/down", "");
};

/** Blocks until `ready` holds or `timeoutMs` passes; for a process the far side started. */
export const waitUntil = (ready: () => boolean, timeoutMs = 5_000): boolean => {
  const tick = new Int32Array(new SharedArrayBuffer(4));
  for (let waited = 0; waited < timeoutMs; waited += 50) {
    if (ready()) return true;
    Atomics.wait(tick, 0, 0, 50);
  }
  return ready();
};

/** Whether a process is alive on this machine. */
export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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
  return Layer.mergeAll(CrewWorkspace.layer, CrewIntegration.layer, CrewApp.layer).pipe(
    Layer.provideMerge(checks),
    Layer.provideMerge(crewStoreLayer),
  );
};

/** Runs `body` against a fresh service repository. */
export const withCrewService = <A, E, R, LE>(
  body: (root: string) => Effect.Effect<A, E, R>,
  layer: (root: string) => Layer.Layer<R, LE>,
) =>
  Effect.gen(function* () {
    const root = makeServiceRepository();
    return yield* body(root).pipe(Effect.provide(layer(root)));
  });
