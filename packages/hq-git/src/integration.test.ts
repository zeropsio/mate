// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
// @effect-diagnostics globalTimers:off -- polls and deadlines against real processes and sockets.
// @effect-diagnostics globalDate:off -- wall-clock bounds and file mtimes of real git debris.
// @effect-diagnostics globalDateInEffect:off -- the same wall-clock reads, inside test fixtures.
import { describe, expect, it, vi } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeZlib from "node:zlib";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { GitRunner } from "./git.ts";
import { refusalReport } from "./protocol.ts";
import { GitError, makeHqGit, type HqGit, type HqGitOptions, type Principal } from "./index.ts";

let dir: string;
let git: HqGit;
let server: NodeHttp.Server | undefined;
let origin: string;
let decisions = 0;
let denyRead = false;
const packageDir = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const mate: Principal = { kind: "mate", mateId: "alice", appId: "app" };
const env = () => ({
  PATH: "/usr/bin:/bin",
  HOME: NodePath.join(dir, "client-home"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
});
const run = (cwd: string, args: string[], principal = "core", input?: string | Buffer) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        `http.extraHeader=X-Principal: ${principal}`,
        ...args,
      ],
      { cwd, env: env(), maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") reject(error);
        else
          resolve({
            code: typeof error?.code === "number" ? error.code : 0,
            stdout: stdout.trim(),
            stderr,
          });
      },
    );
    child.stdin?.end(input);
  });
const checked = async (
  cwd: string,
  args: string[],
  principal = "core",
  input?: string | Buffer,
) => {
  const result = await run(cwd, args, principal, input);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout;
};
const commit = async (cwd: string, parent?: string) => {
  const tree = await checked(cwd, ["mktree"], "core", "");
  return checked(cwd, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "test"]);
};
const source = async () => {
  const path = NodePath.join(dir, "source");
  await checked(dir, ["init", "-b", "main", path]);
  const sha = await commit(path);
  await checked(path, ["update-ref", "refs/heads/main", sha]);
  return { path, sha };
};
const url = () => `${origin}/git/app/repo.git`;
const repoDir = () => NodePath.join(dir, "repos", "app", "repo.git");
const prepare = Effect.fnUntraced(function* () {
  yield* Effect.promise(startServer);
  yield* git.create({ appId: "app", id: "repo" });
  const initial = yield* Effect.promise(source);
  yield* Effect.promise(() => checked(initial.path, ["push", url(), "main"]));
  const clone = NodePath.join(dir, "clone");
  yield* Effect.promise(() => checked(dir, ["clone", url(), clone], "mate"));
  return { clone, sha: initial.sha };
});
const packOf = (cwd: string, sha: string) =>
  new Promise<Buffer>((resolve, reject) => {
    const child = NodeChildProcess.execFile(
      "git",
      ["-c", "core.hooksPath=/dev/null", "pack-objects", "--stdout", "--revs"],
      { cwd, env: env(), encoding: "buffer" },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.end(`${sha}\n`);
  });
const pkt = (text: string) => {
  const payload = Buffer.from(text);
  return Buffer.concat([Buffer.from((payload.length + 4).toString(16).padStart(4, "0")), payload]);
};
const post = async (body: Buffer, principal = "mate", headers: Record<string, string> = {}) => {
  await startServer();
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = NodeHttp.request(
      `${url()}/git-receive-pack`,
      {
        method: "POST",
        headers: {
          "X-Principal": principal,
          "Content-Type": "application/x-git-receive-pack-request",
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    // Fragment even the length prefix to exercise the streaming parser.
    for (let i = 0; i < body.length; i += 3) req.write(body.subarray(i, i + 3));
    req.end();
  });
};

/** Raw request: the path is sent byte for byte, never normalized by a URL parser. */
const raw = (
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: Buffer } = {},
) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = NodeHttp.request(
      { host: "127.0.0.1", port: Number(new URL(origin).port), path, method: options.method },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
        res.on("error", reject);
      },
    );
    for (const [name, value] of Object.entries({ "X-Principal": "core", ...options.headers }))
      req.setHeader(name, value);
    req.on("error", reject);
    req.end(options.body);
  });
/** Sends `head` and bytes on a raw socket; resolves with what came back once it closes. */
const exchange = (head: string, bytes: Buffer) =>
  new Promise<{ response: string; ms: number }>((resolve) => {
    const started = Date.now();
    const socket = NodeNet.connect(Number(new URL(origin).port), "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", () => {});
    socket.on("close", () =>
      resolve({ response: Buffer.concat(chunks).toString(), ms: Date.now() - started }),
    );
    socket.write(head);
    socket.write(bytes);
  });
const setup = (overrides: Partial<HqGitOptions>) =>
  Effect.gen(function* () {
    dir = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(packageDir, ".test-"))),
      (temp) =>
        Effect.promise(async () => {
          vi.unstubAllEnvs();
          await NodeFSP.rm(temp, { recursive: true, force: true });
        }),
    );
    yield* Effect.promise(() => NodeFSP.mkdir(NodePath.join(dir, "client-home")));
    server = undefined;
    decisions = 0;
    denyRead = false;
    git = yield* makeHqGit({
      rootDir: NodePath.join(dir, "repos"),
      importRoots: [dir],
      authenticate: (req) => {
        switch (req.headers["x-principal"]) {
          case "core":
            return { kind: "core" };
          case "mate":
            return mate;
          case "other-app":
            return { ...mate, appId: "other" };
          case "reader":
            return { kind: "reader", userId: "user" };
          default:
            return null;
        }
      },
      canRead: (principal, repo) =>
        !denyRead && (principal.kind !== "mate" || principal.appId === repo.appId),
      lookupChange: async (repo, mateId, number) =>
        number === 1 ? { appId: repo.appId, mateId, number, open: true } : null,
      // Core allows everything here: the built-in rules must still refuse.
      authorize: (_principal, _repo, updates) => {
        decisions++;
        return updates.map(() => ({ allowed: true }));
      },
      ...overrides,
    });
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        if (server?.listening) {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server!.close((error) => (error ? reject(error) : resolve())),
          );
        }
      }),
    );
  });
const fixture = <A, E, R>(effect: Effect.Effect<A, E, R>, overrides: Partial<HqGitOptions> = {}) =>
  Effect.scoped(Effect.andThen(setup(overrides), effect));
const startServer = async () => {
  if (server?.listening) return;
  server = NodeHttp.createServer(git.handler);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing port");
  origin = `http://127.0.0.1:${address.port}`;
};

describe("repositories and real smart HTTP", () => {
  it.live("creates and lists a bare repository with main as default", () =>
    fixture(
      Effect.gen(function* () {
        const repo = yield* git.create({ appId: "app", id: "repo" });
        expect(repo).toEqual({ appId: "app", id: "repo" });
        expect(yield* git.list()).toEqual([repo]);
        const head = yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(repoDir(), "HEAD"), "utf8"),
        );
        expect(head).toBe("ref: refs/heads/main\n");
      }),
    ),
  );

  it.live("clones, pushes a change, fetches it, and clones as a reader", () =>
    fixture(
      Effect.gen(function* () {
        const { clone, sha } = yield* prepare();
        const next = yield* Effect.promise(() => commit(clone, sha));
        yield* Effect.promise(() =>
          checked(clone, ["push", url(), `${next}:refs/heads/mate/alice/1`], "mate"),
        );
        yield* Effect.promise(() => checked(clone, ["fetch", "origin"], "reader"));
        expect(
          yield* Effect.promise(() => checked(clone, ["rev-parse", "origin/mate/alice/1"])),
        ).toBe(next);
        const reader = NodePath.join(dir, "reader");
        yield* Effect.promise(() => checked(dir, ["clone", url(), reader], "reader"));
        expect(yield* Effect.promise(() => checked(reader, ["rev-parse", "HEAD"]))).toBe(sha);
        expect(decisions).toBe(2);
      }),
    ),
  );

  it.live.each([
    ["refs/heads/mate/bob/1", "mate", "not_your_ref"],
    ["refs/heads/main", "mate", "not_your_ref"],
    ["refs/tags/v1", "mate", "not_your_ref"],
    ["refs/heads/mate/alice/2", "mate", "unknown_change"],
    ["refs/heads/mate/alice/1", "reader", "read_only"],
  ] as const)("refuses %s with the reason printed by git (%s)", ([ref, principal, reason]) =>
    fixture(
      Effect.gen(function* () {
        const { clone, sha } = yield* prepare();
        const next = yield* Effect.promise(() => commit(clone, sha));
        const result = yield* Effect.promise(() =>
          run(clone, ["push", url(), `${next}:${ref}`], principal),
        );
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain(reason);
        expect(
          (yield* Effect.promise(() => run(repoDir(), ["cat-file", "-e", next]))).code,
        ).not.toBe(0);
        expect(yield* Effect.promise(() => checked(repoDir(), ["rev-parse", "main"]))).toBe(sha);
      }),
    ),
  );

  it.live("applies the built-in rules even when Core's authorize allows everything", () =>
    fixture(
      Effect.gen(function* () {
        const { clone, sha } = yield* prepare();
        const before = decisions;
        const next = yield* Effect.promise(() => commit(clone, sha));
        const result = yield* Effect.promise(() =>
          run(clone, ["push", url(), `${next}:refs/heads/main`], "mate"),
        );
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("not_your_ref");
        expect(decisions).toBe(before);
        expect(yield* Effect.promise(() => checked(repoDir(), ["rev-parse", "main"]))).toBe(sha);
      }),
    ),
  );

  it.live("lets Core's authorize refuse more but never less", () =>
    fixture(
      Effect.gen(function* () {
        const { clone, sha } = yield* prepare();
        const next = yield* Effect.promise(() => commit(clone, sha));
        const result = yield* Effect.promise(() =>
          run(clone, ["push", url(), `${next}:refs/heads/mate/alice/1`], "mate"),
        );
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("frozen");
        expect(
          (yield* Effect.promise(() => run(repoDir(), ["cat-file", "-e", next]))).code,
        ).not.toBe(0);
      }),
      {
        authorize: (principal, _repo, updates) =>
          updates.map(() =>
            principal.kind === "mate" ? { allowed: false, reason: "frozen" } : { allowed: true },
          ),
      },
    ),
  );

  it.live("refuses deletion with the reason printed by git", () =>
    fixture(
      Effect.gen(function* () {
        const { clone, sha } = yield* prepare();
        yield* Effect.promise(() =>
          checked(clone, ["push", url(), `${sha}:refs/heads/mate/alice/1`], "mate"),
        );
        const result = yield* Effect.promise(() =>
          run(clone, ["push", url(), ":refs/heads/mate/alice/1"], "mate"),
        );
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("deletion");
        expect(
          yield* Effect.promise(() => checked(repoDir(), ["rev-parse", "refs/heads/mate/alice/1"])),
        ).toBe(sha);
      }),
    ),
  );

  it.live("refuses the entire multi-ref push before storing its new objects", () =>
    fixture(
      Effect.gen(function* () {
        const { clone, sha } = yield* prepare();
        const next = yield* Effect.promise(() => commit(clone, sha));
        const result = yield* Effect.promise(() =>
          run(
            clone,
            ["push", url(), `${next}:refs/heads/mate/alice/1`, `${next}:refs/heads/mate/bob/1`],
            "mate",
          ),
        );
        expect(result.stderr).toContain("not_your_ref");
        expect(result.stderr).toContain("other_ref_refused");
        expect(
          (yield* Effect.promise(() =>
            run(repoDir(), ["show-ref", "--verify", "refs/heads/mate/alice/1"]),
          )).code,
        ).not.toBe(0);
        expect(
          (yield* Effect.promise(() => run(repoDir(), ["cat-file", "-e", next]))).code,
        ).not.toBe(0);
      }),
    ),
  );

  it.live("never runs a hook even if repo config tries to enable it", () =>
    fixture(
      Effect.gen(function* () {
        const { clone, sha } = yield* prepare();
        const hooks = NodePath.join(repoDir(), "hooks");
        yield* Effect.promise(() => NodeFSP.mkdir(hooks, { recursive: true }));
        const sentinel = NodePath.join(dir, "hook-ran");
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(hooks, "pre-receive"),
            `#!/bin/sh\ntouch '${sentinel}'\nexit 1\n`,
          ),
        );
        yield* Effect.promise(() => NodeFSP.chmod(NodePath.join(hooks, "pre-receive"), 0o755));
        yield* Effect.promise(() => checked(repoDir(), ["config", "core.hooksPath", hooks]));
        const next = yield* Effect.promise(() => commit(clone, sha));
        yield* Effect.promise(() =>
          checked(clone, ["push", url(), `${next}:refs/heads/mate/alice/1`], "mate"),
        );
        expect(yield* Effect.promise(() => NodeFSP.readdir(dir))).not.toContain("hook-ran");
      }),
    ),
  );

  it.live.each([
    ["an http URL", () => "http://example.com/repo.git"],
    ["a private https host", () => "https://10.0.0.5/repo.git"],
    ["a loopback https host", () => "https://[::1]/repo.git"],
    ["a project-internal https host", () => "https://db/repo.git"],
    ["https credentials in the URL", () => "https://user:secret@example.com/repo.git"],
    ["another app's repository by path", () => NodePath.join(dir, "repos", "victim", "secret.git")],
    [
      "another app's repository by file URL",
      () => NodeURL.pathToFileURL(NodePath.join(dir, "repos", "victim", "secret.git")).href,
    ],
    ["a relative path", () => NodePath.relative(process.cwd(), NodePath.join(dir, "source"))],
    ["a path outside the import roots", () => NodePath.dirname(packageDir)],
    ["an ssh URL", () => "ssh://git@example.com/repo.git"],
  ] satisfies Array<[string, () => string]>)("refuses to import from %s", ([_name, from]) =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "victim", id: "secret" });
        yield* Effect.promise(() => source());
        const error = yield* Effect.flip(git.import({ appId: "attacker", id: "loot" }, from()));
        expect(error).toMatchObject({ _tag: "GitError", reason: "source_refused" });
        expect(error.message).not.toContain(dir);
        expect(error.message).not.toContain("secret");
        expect(yield* git.list("attacker")).toEqual([]);
      }),
    ),
  );

  it.live("refuses credentials for a local source", () =>
    fixture(
      Effect.gen(function* () {
        const initial = yield* Effect.promise(() => source());
        expect(
          yield* Effect.flip(
            git.import({ appId: "app", id: "repo" }, initial.path, {
              username: "u",
              password: "p",
            }),
          ),
        ).toMatchObject({ reason: "source_refused" });
      }),
    ),
  );

  it.live.each(["path", "file"])(
    "imports branches and tags from a local %s source, never mate/* or pull refs",
    (kind) =>
      fixture(
        Effect.gen(function* () {
          const initial = yield* Effect.promise(() => source());
          for (const ref of [
            "refs/tags/v1",
            "refs/heads/topic",
            "refs/heads/mate/alice/1",
            "refs/pull/1/head",
          ]) {
            yield* Effect.promise(() => checked(initial.path, ["update-ref", ref, initial.sha]));
          }
          yield* Effect.promise(() =>
            checked(initial.path, ["symbolic-ref", "HEAD", "refs/heads/topic"]),
          );
          const repo = yield* git.import(
            { appId: "app", id: "repo" },
            kind === "file" ? NodeURL.pathToFileURL(initial.path).href : initial.path,
          );
          expect(yield* git.list("app")).toEqual([repo]);
          expect(
            yield* Effect.promise(() =>
              checked(repoDir(), ["for-each-ref", "--format=%(refname)"]),
            ),
          ).toBe(["refs/heads/main", "refs/heads/topic", "refs/tags/v1"].join("\n"));
          expect(
            yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(repoDir(), "HEAD"), "utf8")),
          ).toBe("ref: refs/heads/main\n");
          expect(yield* Effect.promise(() => NodeFSP.readdir(repoDir()))).not.toContain(
            "FETCH_HEAD",
          );
          expect(
            yield* Effect.promise(() =>
              NodeFSP.readFile(NodePath.join(repoDir(), "config"), "utf8"),
            ),
          ).not.toContain(initial.path);
        }),
      ),
  );

  it.live("refuses a source without main and leaves nothing behind", () =>
    fixture(
      Effect.gen(function* () {
        const initial = yield* Effect.promise(() => source());
        yield* Effect.promise(() => checked(initial.path, ["branch", "-m", "main", "trunk"]));
        expect(
          yield* Effect.flip(git.import({ appId: "app", id: "repo" }, initial.path)),
        ).toMatchObject({ reason: "no_main" });
        expect(yield* git.list()).toEqual([]);
        expect(
          yield* Effect.promise(() => NodeFSP.readdir(NodePath.join(dir, "repos", "app"))),
        ).toEqual([]);
        yield* git.create({ appId: "app", id: "repo" });
      }),
    ),
  );

  it.live(
    "stops a stalled https import at its deadline and removes the partial repository",
    () =>
      fixture(
        Effect.gen(function* () {
          const peers: Array<Promise<void>> = [];
          // Accepts and reads, never answers the TLS handshake.
          const stall = NodeNet.createServer((socket) => {
            peers.push(new Promise((resolve) => socket.on("close", () => resolve())));
            socket.resume();
          });
          yield* Effect.acquireRelease(
            Effect.promise(
              () => new Promise<void>((resolve) => stall.listen(0, "127.0.0.1", resolve)),
            ),
            () => Effect.sync(() => stall.close()),
          );
          const { port } = stall.address() as NodeNet.AddressInfo;
          const started = Date.now();
          const pending = yield* Effect.forkChild(
            Effect.flip(
              git.import({ appId: "app", id: "repo" }, `https://127.0.0.1:${port}/repo.git`, {
                username: "import-user",
                password: "import-secret",
              }),
            ),
          );
          // Credentials travel in git's environment: never in an argv that `ps` shows.
          const fetching = yield* Effect.promise(async () => {
            for (;;) {
              const commands = NodeChildProcess.execFileSync("ps", ["-eo", "args="])
                .toString()
                .split("\n")
                .filter((command) => command.includes(`127.0.0.1:${port}`));
              if (commands.length > 0) return commands.join("\n");
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          });
          for (const secret of [
            "import-user",
            "import-secret",
            "aW1wb3J0LXVzZXI6aW1wb3J0LXNlY3JldA==",
          ])
            expect(fetching).not.toContain(secret);
          const error = yield* Fiber.join(pending);
          expect(error).toMatchObject({ reason: "timeout" });
          expect(error.message).not.toContain("import-secret");
          expect(Date.now() - started).toBeLessThan(8_000);
          expect(
            yield* Effect.promise(() => NodeFSP.readdir(NodePath.join(dir, "repos", "app"))),
          ).toEqual([]);
          // The whole git process group stops, including the helper that holds the connection.
          expect(peers.length).toBeGreaterThan(0);
          yield* Effect.promise(() => Promise.all(peers));
        }),
        { allowImportHost: () => true, importTimeoutMs: 1_500 },
      ),
    20_000,
  );

  it.live("prints refusal reports with a real stateless git send-pack client", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const initial = yield* Effect.promise(() => source());
        const runner = new GitRunner(NodePath.join(dir, "client-home"));
        try {
          const advertisement = yield* Effect.promise(() =>
            runner.run(["receive-pack", "--stateless-rpc", "--advertise-refs", repoDir()]),
          );
          const ref = "refs/heads/mate/bob/1";
          const report = refusalReport(
            [{ oldSha: "0".repeat(40), newSha: initial.sha, ref }],
            [{ allowed: false, reason: "not_your_ref" }],
            ["report-status-v2", "side-band-64k"],
          );
          const result = yield* Effect.promise(() =>
            run(
              initial.path,
              ["send-pack", "--stateless-rpc", repoDir(), `HEAD:${ref}`],
              "core",
              Buffer.concat([advertisement, report]),
            ),
          );
          expect(result.code).not.toBe(0);
          expect(result.stderr).toContain("not_your_ref");
          expect(
            (yield* Effect.promise(() => run(repoDir(), ["show-ref", "--verify", ref]))).code,
          ).not.toBe(0);
        } finally {
          yield* Effect.promise(() => runner.close());
        }
      }),
    ),
  );

  it.live("disables a malicious hook during real stateless receive-pack without HTTP", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const initial = yield* Effect.promise(() => source());
        const hooks = NodePath.join(repoDir(), "hooks");
        yield* Effect.promise(() => NodeFSP.mkdir(hooks));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(hooks, "pre-receive"),
            `#!/bin/sh\ntouch '${NodePath.join(dir, "hook-ran")}'\nexit 1\n`,
          ),
        );
        yield* Effect.promise(() => NodeFSP.chmod(NodePath.join(hooks, "pre-receive"), 0o755));
        yield* Effect.promise(() => checked(repoDir(), ["config", "core.hooksPath", hooks]));
        const pack = yield* Effect.promise(() => packOf(initial.path, initial.sha));
        const runner = new GitRunner(NodePath.join(dir, "client-home"));
        try {
          const process = runner.start(["receive-pack", "--stateless-rpc", repoDir()]);
          process.child.stdin.end(
            Buffer.concat([
              pkt(`${"0".repeat(40)} ${initial.sha} refs/heads/mate/alice/1\0report-status\n`),
              Buffer.from("0000"),
              pack,
            ]),
          );
          const report: Buffer[] = [];
          yield* Effect.promise(async () => {
            for await (const chunk of process.child.stdout)
              report.push(Buffer.from(chunk as Uint8Array));
          });
          yield* Effect.promise(() => process.done);
          expect(Buffer.concat(report).toString()).toContain("ok refs/heads/mate/alice/1");
          expect(
            yield* Effect.promise(() =>
              checked(repoDir(), ["rev-parse", "refs/heads/mate/alice/1"]),
            ),
          ).toBe(initial.sha);
          expect(yield* Effect.promise(() => NodeFSP.readdir(dir))).not.toContain("hook-ran");
        } finally {
          yield* Effect.promise(() => runner.close());
        }
      }),
    ),
  );

  it.live("converges config without following includes and removes info/attributes", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const config = NodePath.join(repoDir(), "config");
        const include = NodePath.join(dir, "evil-config");
        yield* Effect.promise(() => NodeFSP.writeFile(include, "[core]\n hooksPath = /evil\n"));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            config,
            `[core]\n repositoryformatversion = 0\n bare = false\n fsmonitor = /evil\n[include]\n path = ${include}\n[filter "evil"]\n clean = /evil\n`,
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.mkdir(NodePath.join(repoDir(), "info"), { recursive: true }),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(repoDir(), "info", "attributes"), "* filter=evil\n"),
        );
        yield* git.convergeRepo({ appId: "app", id: "repo" });
        expect(
          yield* Effect.promise(() => NodeFSP.readdir(NodePath.join(repoDir(), "info"))),
        ).not.toContain("attributes");
        const result = yield* Effect.promise(() => NodeFSP.readFile(config, "utf8"));
        expect(result).not.toContain("evil");
        expect(yield* Effect.promise(() => checked(repoDir(), ["config", "core.bare"]))).toBe(
          "true",
        );
        expect(yield* Effect.promise(() => checked(repoDir(), ["config", "core.hooksPath"]))).toBe(
          "/dev/null",
        );
        expect(yield* Effect.promise(() => checked(repoDir(), ["config", "core.fsmonitor"]))).toBe(
          "false",
        );
        expect(
          yield* Effect.promise(() => checked(repoDir(), ["config", "receive.fsckObjects"])),
        ).toBe("true");
      }),
    ),
  );

  it.live("converges away alternates, http-alternates, and grafts", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "victim" });
        yield* git.create({ appId: "app", id: "repo" });
        const files = [
          ["objects", "info", "alternates"],
          ["objects", "info", "http-alternates"],
          ["info", "grafts"],
        ];
        for (const parts of files) {
          const file = NodePath.join(repoDir(), ...parts);
          yield* Effect.promise(() => NodeFSP.mkdir(NodePath.dirname(file), { recursive: true }));
          yield* Effect.promise(() =>
            NodeFSP.writeFile(file, NodePath.join(dir, "repos", "app", "victim.git", "objects")),
          );
        }
        yield* git.convergeRepo({ appId: "app", id: "repo" });
        for (const parts of files) {
          expect(
            yield* Effect.promise(() =>
              NodeFSP.readdir(NodePath.join(repoDir(), ...parts.slice(0, -1))),
            ),
          ).not.toContain(parts.at(-1));
        }
      }),
    ),
  );

  it.live("sweeps stale locks, quarantines and scratch directories but keeps fresh ones", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const stale = [
          "packed-refs.lock",
          "refs/heads/mate/alice/1.lock",
          "objects/tmp_objdir-incoming-old",
          ".index-old",
          ".archive-old",
          ".config-old",
        ];
        const fresh = [
          "HEAD.lock",
          "refs/heads/main.lock",
          "objects/tmp_objdir-incoming-new",
          ".index-new",
        ];
        const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
        for (const name of [...stale, ...fresh]) {
          const path = NodePath.join(repoDir(), name);
          yield* Effect.promise(async () => {
            await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
            if (name.includes("tmp_objdir")) {
              await NodeFSP.mkdir(NodePath.join(path, "pack"), { recursive: true });
              await NodeFSP.writeFile(NodePath.join(path, "pack", "tmp_pack_x"), "partial");
            } else if (name.startsWith(".")) {
              await NodeFSP.mkdir(path);
              await NodeFSP.writeFile(NodePath.join(path, "index"), "partial");
            } else await NodeFSP.writeFile(path, "");
            if (stale.includes(name)) await NodeFSP.utimes(path, past, past);
          });
        }
        yield* git.convergeRepo({ appId: "app", id: "repo" });
        const exists = (name: string) =>
          NodeFSP.stat(NodePath.join(repoDir(), name)).then(
            () => true,
            () => false,
          );
        for (const name of stale) expect(yield* Effect.promise(() => exists(name))).toBe(false);
        for (const name of fresh) expect(yield* Effect.promise(() => exists(name))).toBe(true);
      }),
    ),
  );

  it.live("sweeps a crashed instance's reservations, staging, and homes on open", () =>
    fixture(
      Effect.gen(function* () {
        const root = NodePath.join(dir, "crashed");
        yield* Effect.promise(async () => {
          for (const debris of [
            ".home-old/x",
            "app/.build-old/repo.git/HEAD",
            "app/kept.git/HEAD",
            "app/kept.git/.index-old/index",
            "app/kept.git/.archive-old/index",
            "app/kept.git/.config-old/config",
          ]) {
            await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, debris)), { recursive: true });
            await NodeFSP.writeFile(NodePath.join(root, debris), "");
          }
          await NodeFSP.mkdir(NodePath.join(root, "app", "ghost.git"));
        });
        const listed = yield* Effect.scoped(
          Effect.gen(function* () {
            const reopened = yield* makeHqGit({
              rootDir: root,
              authenticate: () => null,
              canRead: () => false,
              lookupChange: async () => null,
            });
            return yield* reopened.list();
          }),
        );
        expect(listed).toEqual([{ appId: "app", id: "kept" }]);
        expect(yield* Effect.promise(() => NodeFSP.readdir(root))).toEqual(["app"]);
        expect(yield* Effect.promise(() => NodeFSP.readdir(NodePath.join(root, "app")))).toEqual([
          "kept.git",
        ]);
        expect(
          yield* Effect.promise(() => NodeFSP.readdir(NodePath.join(root, "app", "kept.git"))),
        ).toEqual(["HEAD"]);
      }),
    ),
  );

  it.live.each([
    "/git/app/../app/repo.git/info/refs?service=git-upload-pack",
    "/git/app/%2e%2e/app/repo.git/info/refs?service=git-upload-pack",
    "/git/app/%2E%2E/app/repo.git/info/refs?service=git-upload-pack",
    "/git/app/./repo.git/info/refs?service=git-upload-pack",
    "/git/app/repo.git/../repo.git/info/refs?service=git-upload-pack",
    "/git/%2e%2e/git/app/repo.git/info/refs?service=git-upload-pack",
    "/git//app/repo.git/info/refs?service=git-upload-pack",
    "/git/app/repo%2egit/info/refs?service=git-upload-pack",
    "/git/app%2frepo.git/info/refs?service=git-upload-pack",
  ])("answers 404 to the traversal %s", (path) =>
    fixture(
      Effect.gen(function* () {
        yield* prepare();
        expect(
          (yield* Effect.promise(() => raw("/git/app/repo.git/info/refs?service=git-upload-pack")))
            .status,
        ).toBe(200);
        expect((yield* Effect.promise(() => raw(path))).status).toBe(404);
      }),
    ),
  );

  it.live.each([
    ["unauthenticated", "none", "/git/app/repo.git/git-receive-pack", 401],
    ["refused read", "other-app", "/git/app/repo.git/git-receive-pack", 403],
    ["unknown repository", "core", "/git/app/missing.git/git-receive-pack", 404],
    ["wrong method", "core", "/git/app/repo.git/info/refs?service=git-receive-pack", 405],
    ["wrong content type", "core", "/git/app/repo.git/git-upload-pack", 415],
  ] as const)(
    "answers %s and closes without reading the body",
    ([_name, principal, path, status]) =>
      fixture(
        Effect.gen(function* () {
          yield* prepare();
          const response = yield* Effect.promise(
            () =>
              new Promise<string>((resolve, reject) => {
                const socket = NodeNet.connect(Number(new URL(origin).port), "127.0.0.1");
                const chunks: Buffer[] = [];
                socket.on("data", (chunk: Buffer) => chunks.push(chunk));
                socket.on("close", () => resolve(Buffer.concat(chunks).toString()));
                socket.on("error", () => {});
                const timer = setTimeout(() => {
                  socket.destroy();
                  reject(new Error("server kept the connection open to read the body"));
                }, 3_000);
                socket.on("close", () => clearTimeout(timer));
                socket.write(
                  `POST ${path} HTTP/1.1\r\nHost: git\r\nX-Principal: ${principal}\r\n` +
                    "Content-Type: text/plain\r\nContent-Length: 1073741824\r\n\r\n",
                );
                socket.write(Buffer.alloc(16 * 1024, 0x30));
              }),
          );
          expect(response).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `));
          expect(response.toLowerCase()).toContain("connection: close");
        }),
      ),
  );

  it.live("accepts a gzip-encoded receive-pack body", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const initial = yield* Effect.promise(() => source());
        const pack = yield* Effect.promise(() => packOf(initial.path, initial.sha));
        const body = Buffer.concat([
          pkt(`${"0".repeat(40)} ${initial.sha} refs/heads/mate/alice/1\0report-status\n`),
          Buffer.from("0000"),
          pack,
        ]);
        const response = yield* Effect.promise(() =>
          post(NodeZlib.gzipSync(body), "mate", { "Content-Encoding": "gzip" }),
        );
        expect(response.status).toBe(200);
        expect(response.body).toContain("ok refs/heads/mate/alice/1");
        expect(
          yield* Effect.promise(() => checked(repoDir(), ["rev-parse", "refs/heads/mate/alice/1"])),
        ).toBe(initial.sha);
      }),
    ),
  );

  it.live("refuses the push-options capability before authorizing", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const response = yield* Effect.promise(() =>
          post(
            Buffer.concat([
              pkt(`${"0".repeat(40)} ${"1".repeat(40)} refs/heads/mate/alice/1\0push-options\n`),
              Buffer.from("0000"),
            ]),
          ),
        );
        expect(response.status).toBe(400);
        expect(decisions).toBe(0);
      }),
    ),
  );

  it.live(
    "ends a stalled upload-pack at the request deadline",
    () =>
      fixture(
        Effect.gen(function* () {
          yield* prepare();
          const { response, ms } = yield* Effect.promise(() =>
            exchange(
              "POST /git/app/repo.git/git-upload-pack HTTP/1.1\r\nHost: git\r\nX-Principal: core\r\n" +
                "Content-Type: application/x-git-upload-pack-request\r\n" +
                "Transfer-Encoding: chunked\r\n\r\n",
              Buffer.from(`4\r\n0032\r\n`),
            ),
          );
          expect(ms).toBeGreaterThanOrEqual(400);
          expect(ms).toBeLessThan(5_000);
          expect(response).not.toContain("HTTP/1.1 200");
        }),
        { requestTimeoutMs: 500 },
      ),
    15_000,
  );

  it.live(
    "ends a trickling refused push at the request deadline after its report",
    () =>
      fixture(
        Effect.gen(function* () {
          yield* git.create({ appId: "app", id: "repo" });
          yield* Effect.promise(startServer);
          const { response, ms } = yield* Effect.promise(() =>
            exchange(
              "POST /git/app/repo.git/git-receive-pack HTTP/1.1\r\nHost: git\r\nX-Principal: mate\r\n" +
                "Content-Type: application/x-git-receive-pack-request\r\nContent-Length: 1048576\r\n\r\n",
              Buffer.concat([
                pkt(`${"0".repeat(40)} ${"1".repeat(40)} refs/heads/mate/bob/1\0report-status\n`),
                Buffer.from("0000PACK"),
              ]),
            ),
          );
          expect(response).toContain("ng refs/heads/mate/bob/1 not_your_ref");
          expect(ms).toBeGreaterThanOrEqual(400);
          expect(ms).toBeLessThan(5_000);
        }),
        { requestTimeoutMs: 500 },
      ),
    15_000,
  );

  const pushBody = Effect.fnUntraced(function* () {
    yield* git.create({ appId: "app", id: "repo" });
    const initial = yield* Effect.promise(() => source());
    const pack = yield* Effect.promise(() => packOf(initial.path, initial.sha));
    const body = Buffer.concat([
      pkt(`${"0".repeat(40)} ${initial.sha} refs/heads/mate/alice/1\0report-status\n`),
      Buffer.from("0000"),
      pack,
    ]);
    const head =
      "POST /git/app/repo.git/git-receive-pack HTTP/1.1\r\nHost: git\r\nX-Principal: mate\r\n" +
      `Content-Type: application/x-git-receive-pack-request\r\nContent-Length: ${body.length}\r\n\r\n`;
    yield* Effect.promise(startServer);
    return { body, head };
  });
  const until = async (check: () => Promise<boolean>) => {
    for (const started = Date.now(); Date.now() - started < 5_000;) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };
  const quarantines = () =>
    NodeFSP.readdir(NodePath.join(repoDir(), "objects")).then((names) =>
      names.filter((name) => name.startsWith("tmp_objdir-incoming-")),
    );

  it.live("leaves no lock or quarantine when the client disconnects mid-push", () =>
    fixture(
      Effect.gen(function* () {
        const { body, head } = yield* pushBody();
        const socket = NodeNet.connect(Number(new URL(origin).port), "127.0.0.1");
        socket.on("error", () => {});
        socket.write(head);
        socket.write(body.subarray(0, body.length - 20));
        // receive-pack is mid-unpack once its quarantine exists.
        expect(
          yield* Effect.promise(() => until(async () => (await quarantines()).length > 0)),
        ).toBe(true);
        socket.destroy();
        expect(
          yield* Effect.promise(() => until(async () => (await quarantines()).length === 0)),
        ).toBe(true);
        yield* git.convergeRepo({ appId: "app", id: "repo" });
        const names = yield* Effect.promise(() => NodeFSP.readdir(repoDir(), { recursive: true }));
        expect(names.filter((name) => name.endsWith(".lock") || name.includes("tmp_"))).toEqual([]);
        expect(
          (yield* Effect.promise(() =>
            run(repoDir(), ["show-ref", "--verify", "refs/heads/mate/alice/1"]),
          )).code,
        ).not.toBe(0);
      }),
    ),
  );

  it.live("requires authentication and read authorization", () =>
    fixture(
      Effect.gen(function* () {
        yield* prepare();
        for (const principal of ["none", "other-app"]) {
          const result = yield* Effect.promise(() => run(dir, ["ls-remote", url()], principal));
          expect(result.code).not.toBe(0);
          // A 401 with `WWW-Authenticate` makes git ask for credentials; with prompts disabled it says so.
          expect(result.stderr).toContain(principal === "none" ? "could not read Username" : "403");
        }
        denyRead = true;
        expect(
          (yield* Effect.promise(() => run(dir, ["ls-remote", url()], "reader"))).stderr,
        ).toContain("403");
      }),
    ),
  );

  it.live("rejects malformed commands and duplicate refs without authorizing or writing", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const line = `${"0".repeat(40)} ${"1".repeat(40)} refs/heads/mate/alice/1`;
        for (const body of [
          Buffer.from("0003"),
          Buffer.from("zzzz"),
          pkt(line),
          Buffer.concat([pkt(line), pkt(line), Buffer.from("0000")]),
        ]) {
          const result = yield* Effect.promise(() => post(body));
          expect(result.status).toBe(400);
        }
        expect(decisions).toBe(0);
      }),
    ),
  );

  it.live("returns per-ref reports for fragmented commands with and without sideband", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        for (const capabilities of ["report-status", "report-status-v2 side-band-64k"]) {
          const body = Buffer.concat([
            pkt(`${"0".repeat(40)} ${"1".repeat(40)} refs/heads/mate/bob/1\0${capabilities}\n`),
            Buffer.from("0000PACKnot-a-real-pack"),
          ]);
          const response = yield* Effect.promise(() => post(body));
          expect(response.status).toBe(200);
          expect(response.body).toContain("ng refs/heads/mate/bob/1 not_your_ref\n");
          expect(response.body).toContain("unpack ok\n");
        }
      }),
    ),
  );

  it.live("isolates inherited git environment and global config for every subprocess", () =>
    fixture(
      Effect.gen(function* () {
        const initial = yield* Effect.promise(() => source());
        const fakeHome = NodePath.join(dir, "poison-home");
        yield* Effect.promise(() => NodeFSP.mkdir(fakeHome));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(fakeHome, ".gitconfig"),
            "[init]\n defaultBranch = poisoned\n[core]\n hooksPath = /evil\n",
          ),
        );
        vi.stubEnv("HOME", fakeHome);
        vi.stubEnv("GIT_DIR", NodePath.join(dir, "missing-repository"));
        vi.stubEnv("GIT_CONFIG_COUNT", "1");
        vi.stubEnv("GIT_CONFIG_KEY_0", "core.bare");
        vi.stubEnv("GIT_CONFIG_VALUE_0", "false");
        vi.stubEnv("GIT_CONFIG_GLOBAL", NodePath.join(fakeHome, ".gitconfig"));
        yield* git.import({ appId: "app", id: "repo" }, initial.path);
        yield* git.convergeRepo({ appId: "app", id: "repo" });
        expect(
          yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(repoDir(), "HEAD"), "utf8")),
        ).toBe("ref: refs/heads/main\n");
        expect(yield* Effect.promise(() => checked(repoDir(), ["rev-parse", "main"]))).toBe(
          initial.sha,
        );
        const homes = (yield* Effect.promise(() =>
          NodeFSP.readdir(NodePath.join(dir, "repos")),
        )).filter((name) => name.startsWith(".home-"));
        expect(homes).toHaveLength(1);
        expect(
          yield* Effect.promise(() => NodeFSP.readdir(NodePath.join(dir, "repos", homes[0]!))),
        ).toEqual([]);
      }),
    ),
  );

  it.live.each([
    ["a trailing-slash prefix", { pathPrefix: "/git/" }],
    ["a negative request deadline", { requestTimeoutMs: -1 }],
    ["a NaN import deadline", { importTimeoutMs: Number.NaN }],
  ] satisfies Array<[string, Partial<HqGitOptions>]>)("refuses to open with %s", ([_name, bad]) =>
    fixture(
      Effect.gen(function* () {
        const error = yield* Effect.scoped(
          makeHqGit({
            rootDir: NodePath.join(dir, "other"),
            authenticate: () => null,
            canRead: () => false,
            lookupChange: async () => null,
            ...bad,
          }),
        ).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "GitError", reason: "invalid_config" });
      }),
    ),
  );

  it.live("fails with a literal reason and a message free of server paths", () =>
    fixture(
      Effect.gen(function* () {
        yield* git.create({ appId: "app", id: "repo" });
        const failures: Array<[Effect.Effect<unknown, GitError>, GitError["reason"]]> = [
          [git.create({ appId: "app", id: "repo" }), "exists"],
          [git.create({ appId: "..", id: "repo" }), "invalid_id"],
          [git.list("../app"), "invalid_id"],
          [git.convergeRepo({ appId: "app", id: "missing" }), "not_found"],
          [git.convergeRepo({ appId: "app", id: "../app/repo" }), "invalid_id"],
        ];
        for (const [effect, reason] of failures) {
          const error = yield* effect.pipe(Effect.asVoid, Effect.flip);
          expect(error).toMatchObject({ _tag: "GitError", reason });
          expect(error.message).not.toContain(dir);
        }
      }),
    ),
  );
});
