// @effect-diagnostics nodeBuiltinImport:off -- disposable Git repositories exercise real processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";
import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { deliverRef, type PushEvidence } from "./gitPush.ts";
import { withGitCredential } from "./gitAskpass.ts";
import { startGitChild, type GitChildAnswer, type GitChildRequest } from "./gitPushChild.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as PlatformNodePath from "@effect/platform-node/NodePath";
import * as Layer from "effect/Layer";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});
const git = async (cwd: string, args: string[]) =>
  (
    await exec("git", args, {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    })
  ).stdout.trim();
const fixture = async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-push-test-"));
  roots.push(root);
  const remote = NodePath.join(root, "remote.git");
  const directory = NodePath.join(root, "source");
  await git(root, ["init", "--bare", remote]);
  await git(root, ["init", directory]);
  await git(directory, ["config", "user.name", "Delivery test"]);
  await git(directory, ["config", "user.email", "delivery@example.test"]);
  const commit = async (value: string) => {
    await NodeFSP.writeFile(NodePath.join(directory, "file"), value);
    await git(directory, ["add", "file"]);
    await git(directory, ["commit", "-m", value]);
    return git(directory, ["rev-parse", "HEAD"]);
  };
  const first = await commit("first");
  await git(directory, ["push", remote, `${first}:refs/heads/main`]);
  const second = await commit("second");
  return {
    root,
    remote,
    directory,
    first,
    second,
    commit,
    input: {
      directory,
      url: remote,
      identity: "local-disposable",
      ref: "refs/heads/main",
      sha: second,
      keptAt: "test-kept-at",
      token: Redacted.make("credential-marker"),
      confirmed: first,
    },
  };
};

it.live("delivers the fixed commit by an atomic old-tip compare after proving ancestry", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    const result = yield* deliverRef(f.input);
    expect(result.state).toBe("pushed");
    expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", "refs/heads/main"]))).toBe(
      f.second,
    );
  }),
);

/**
 * The remote answers each push as GitHub does when main's ruleset requires `check` (GH013): one
 * answer per push, `ok` accepts it.
 */
const requireCheck = (remote: string, answers: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    const hook = NodePath.join(remote, "hooks", "pre-receive");
    await NodeFSP.writeFile(`${hook}.answers`, answers.join("\n") + "\n");
    await NodeFSP.writeFile(
      hook,
      [
        "#!/bin/sh",
        'first=$(head -n 1 "$0.answers")',
        'tail -n +2 "$0.answers" > "$0.rest" && mv "$0.rest" "$0.answers"',
        '[ "$first" = ok ] && exit 0',
        'echo "error: GH013: Repository rule violations found for refs/heads/main." >&2',
        'echo "Review all repository rules at https://github.com/acme/app/rules?ref=refs%2Fheads%2Fmain" >&2',
        'echo "" >&2',
        'echo "- Required status check \\"check\\" is $first." >&2',
        "exit 1",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );
  });

it.effect.each([
  {
    answers: ["in progress", "ok"],
    holdUntil: undefined,
    state: "pushed",
    reason: undefined,
    waited: true,
  },
  {
    answers: ["failing"],
    holdUntil: undefined,
    state: "refused",
    reason: `GitHub refused SHORT: its required check "check" failed. Fix it on main, then release again.`,
    waited: false,
  },
  {
    answers: ["expected"],
    holdUntil: undefined,
    state: "refused",
    reason: `GitHub refused SHORT: its required check "check" never ran on it. Release a commit stage tested.`,
    waited: false,
  },
  {
    answers: ["in progress"],
    holdUntil: 0,
    state: "refused",
    reason: `GitHub still held SHORT when Mate stopped waiting: its required check "check" hadn't passed. Release again once it does.`,
    waited: false,
  },
])(
  "GitHub's required-check refusal reads as waiting, red or never ran: $answers",
  ({ answers, holdUntil, state, reason, waited }) =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* requireCheck(f.remote, answers);
      const said: string[] = [];
      const fiber = yield* deliverRef(
        { ...f.input, ...(holdUntil === undefined ? {} : { holdUntil }) },
        (evidence) => Effect.sync(() => void said.push(evidence.nextAction)),
      ).pipe(Effect.forkChild);
      // The writer's half-minute wait runs on the test clock; Git itself runs on the real one.
      while (fiber.pollUnsafe() === undefined) {
        yield* TestClock.withLive(Effect.sleep("50 millis"));
        yield* TestClock.adjust("30 seconds");
      }
      const result = yield* Fiber.join(fiber);
      const short = f.second.slice(0, 7);
      expect([result.state, result.reason]).toEqual([state, reason?.replace("SHORT", short)]);
      expect(
        said.includes(
          `GitHub holds ${short} until its required check "check" passes; Mate pushes again then.`,
        ),
      ).toBe(waited);
      expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", "refs/heads/main"]))).toBe(
        state === "pushed" ? f.second : f.first,
      );
    }),
);

it.live(
  "HQ never force-pushes: a moved remote branch ends the push refused, with the remote's words.",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      const third = yield* Effect.promise(() => f.commit("third"));
      yield* Effect.promise(() => git(f.remote, ["fetch", f.directory, third]));
      const result = yield* deliverRef(f.input, (evidence) =>
        Effect.promise(async () => {
          if (evidence.phase === "prepared")
            await git(f.remote, ["update-ref", "refs/heads/main", third]);
        }),
      );
      expect(result.state).toBe("refused");
      expect(result.reason).toContain("[rejected]");
      expect(result.reason).toContain("stale info");
      expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", "refs/heads/main"]))).toBe(
        third,
      );
    }),
);

it.live.each(["moved", "rewound", "deleted"])(
  "refuses a %s last confirmed ref before any external write",
  (change) =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.promise(() => git(f.remote, ["fetch", f.directory, f.second]));
      yield* Effect.promise(() => git(f.remote, ["update-ref", "refs/heads/main", f.second]));
      const third = yield* Effect.promise(() => f.commit("third"));
      if (change === "deleted")
        yield* Effect.promise(() => git(f.remote, ["update-ref", "-d", "refs/heads/main"]));
      else if (change === "rewound")
        yield* Effect.promise(() => git(f.remote, ["update-ref", "refs/heads/main", f.first]));
      else {
        yield* Effect.promise(() => git(f.remote, ["fetch", f.directory, third]));
        yield* Effect.promise(() => git(f.remote, ["update-ref", "refs/heads/main", third]));
      }
      const attempted: PushEvidence[] = [];
      const intended = yield* Effect.promise(() => f.commit("fourth"));
      const result = yield* deliverRef({ ...f.input, sha: intended, confirmed: f.second }, (e) =>
        Effect.sync(() => {
          attempted.push(e);
        }),
      );
      expect(result.state).toBe("refused");
      expect(result.reason).toContain(change === "deleted" ? "missing" : "moved");
      expect(attempted.some((e) => e.phase === "prepared")).toBe(false);
      const refs = yield* Effect.promise(() =>
        git(f.remote, ["for-each-ref", "--format=%(objectname)", "refs/heads/main"]),
      );
      expect(refs).toBe(change === "deleted" ? "" : change === "rewound" ? f.first : third);
    }),
);

it.live("rejects a non-ancestor before receive-pack, even with an exact lease", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.promise(() => git(f.remote, ["fetch", f.directory, f.second]));
    yield* Effect.promise(() => git(f.remote, ["update-ref", "refs/heads/main", f.second]));
    const result = yield* deliverRef({ ...f.input, sha: f.first, confirmed: f.second });
    expect(result.state).toBe("refused");
    expect(result.reason).toContain("not an ancestor");
    expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", "refs/heads/main"]))).toBe(
      f.second,
    );
  }),
);

it.live("creates only an expected-absent branch and refuses a racing creation", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    const ref = "refs/heads/new";
    const result = yield* deliverRef({ ...f.input, ref, confirmed: null }, (e) =>
      Effect.promise(async () => {
        if (e.phase === "prepared") await git(f.remote, ["update-ref", ref, f.first]);
      }),
    );
    expect(result.state).toBe("refused");
    expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", ref]))).toBe(f.first);
    const created = yield* deliverRef({ ...f.input, ref: "refs/heads/absent", confirmed: null });
    expect(created.state).toBe("pushed");
    expect(created.evidence.before).toBeNull();
    expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", "refs/heads/absent"]))).toBe(
      f.second,
    );
  }),
);

it.live(
  "A push whose answer was lost is settled by reading the remote ref, never by pushing again blind.",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      const count = NodePath.join(f.root, "writes");
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(f.remote, "hooks/pre-receive"),
          `#!/bin/sh\necho write >> '${count}'\n`,
          { mode: 0o700 },
        ),
      );
      let saved: PushEvidence | undefined;
      const lost = yield* Effect.exit(
        deliverRef(f.input, (e) => {
          if (e.witness !== undefined && e.writerDrained) return Effect.fail("lost answer");
          saved = e;
          return Effect.void;
        }),
      );
      expect(lost._tag).toBe("Failure");
      expect(saved?.writerDrained).toBe(false);
      const result = yield* deliverRef(f.input, () => Effect.void, saved);
      expect(result.state).toBe("pushed");
      expect(result.evidence.via).toBe("resolve");
      expect(result.evidence.writerDrained).toBe(true);
      expect(yield* Effect.promise(() => NodeFSP.readFile(count, "utf8"))).toBe("write\n");
      expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", "refs/heads/main"]))).toBe(
        f.second,
      );
    }),
);

it.live("retains a foreign third tip as unresolved and never refreshes the original lease", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    let saved: PushEvidence | undefined;
    yield* Effect.exit(
      deliverRef(f.input, (e) => {
        if (e.witness !== undefined && e.writerDrained) return Effect.fail("lost answer");
        saved = e;
        return Effect.void;
      }),
    );
    const third = yield* Effect.promise(() => f.commit("foreign third"));
    yield* Effect.promise(() => git(f.remote, ["fetch", f.directory, third]));
    yield* Effect.promise(() => git(f.remote, ["update-ref", "refs/heads/main", third]));
    const result = yield* deliverRef(f.input, () => Effect.void, saved);
    expect(result.state).toBe("unresolved");
    expect(result.evidence.before).toBe(f.first);
    expect(result.evidence.observed).toBe(third);
    expect(result.evidence.sha).toBe(f.second);
    expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", "refs/heads/main"]))).toBe(
      third,
    );
  }),
);

it.live("an unknown writer blocks even a ref already at the intended commit", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.promise(() =>
      git(f.directory, ["push", f.remote, `${f.second}:refs/heads/main`]),
    );
    const saved: PushEvidence = {
      phase: "writing",
      processes: [],
      version: null,
      nextActor: "hq",
      nextAction: "Follow writer",
      remote: f.remote,
      identity: f.input.identity,
      ref: f.input.ref,
      sha: f.second,
      keptAt: f.input.keptAt,
      before: f.first,
      writerDrained: false,
      witness: NodePath.join(f.root, "missing-writer-receipt"),
    };
    const result = yield* deliverRef(f.input, () => Effect.void, saved);
    expect(result.state).toBe("unresolved");
    expect(result.evidence.writerDrained).toBe(false);
    expect(result.reason).toContain("cannot be proven stopped");
  }),
);

const credentialed = <A>(use: Parameters<typeof withGitCredential<A, never, never>>[1]) =>
  withGitCredential(Redacted.make("credential-marker"), use).pipe(
    Effect.provide(Layer.mergeAll(NodeFileSystem.layer, PlatformNodePath.layer)),
  );
const alive = (pid: number | null) => {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const terminalReceipt = (witness: string) =>
  new Promise<GitChildAnswer>((resolve, reject) => {
    const watcher = NodeFS.watch(NodePath.dirname(witness), () => {
      void read();
    });
    const timeout = AbortSignal.timeout(5000);
    const abort = () => {
      watcher.close();
      reject(new Error("No terminal writer receipt"));
    };
    timeout.addEventListener("abort", abort, { once: true });
    const read = async () => {
      try {
        const answer = JSON.parse(await NodeFSP.readFile(witness, "utf8")) as GitChildAnswer;
        if (typeof answer.code !== "number") return;
        watcher.close();
        timeout.removeEventListener("abort", abort);
        resolve(answer);
      } catch {
        /* The next atomic receipt event supplies it. */
      }
    };
    void read();
  });

it.live(
  "the captured Git group reaches its child-local deadline before the same fixed sha may retry",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nsleep 30\n", {
          mode: 0o700,
        }),
      );
      const witness = NodePath.join(f.directory, "deadline.json");
      const answer = yield* credentialed((credential) =>
        Effect.promise(async () => {
          const owned = startGitChild({
            mode: "push",
            directory: f.directory,
            url: f.remote,
            ref: f.input.ref,
            sha: f.second,
            before: f.first,
            credential,
            witness,
            deadlineMs: 250,
          });
          return owned.done;
        }),
      );
      expect(answer?.timedOut).toBe(true);
      expect(answer?.drained).toBe(true);
      expect(alive(answer!.pid)).toBe(false);
      expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", f.input.ref]))).toBe(f.first);
      yield* Effect.promise(() => NodeFSP.rm(NodePath.join(f.remote, "hooks/pre-receive")));
      const previous: PushEvidence = {
        phase: "writing",
        processes: [],
        version: null,
        nextActor: "hq",
        nextAction: "Follow original writer",
        remote: f.remote,
        identity: f.input.identity,
        ref: f.input.ref,
        sha: f.second,
        keptAt: f.input.keptAt,
        before: f.first,
        witness,
        writerDrained: false,
      };
      const result = yield* deliverRef(f.input, () => Effect.void, previous);
      expect(result.state).toBe("pushed");
      expect(result.evidence.before).toBe(f.first);
      expect(result.evidence.sha).toBe(f.second);
      expect(result.evidence.writerDrained).toBe(true);
      expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", f.input.ref]))).toBe(f.second);
    }),
);

it.live("a pipe-detached helper is stopped before its captured Git group is recorded drained", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    const helperFile = NodePath.join(f.root, "helper-pid");
    const quotedFile = "'" + helperFile.replaceAll("'", "'\"'\"'") + "'";
    yield* Effect.promise(() =>
      NodeFSP.writeFile(
        NodePath.join(f.remote, "hooks/pre-receive"),
        `#!/bin/sh\nsleep 30 </dev/null >/dev/null 2>&1 &\nprintf '%s\\n' "$!" > ${quotedFile}\nexit 1\n`,
        { mode: 0o700 },
      ),
    );
    const answer = yield* credentialed((credential) =>
      Effect.promise(
        () =>
          startGitChild({
            mode: "push",
            directory: f.directory,
            url: f.remote,
            ref: f.input.ref,
            sha: f.second,
            before: f.first,
            credential,
            witness: NodePath.join(f.directory, "helper.json"),
            deadlineMs: 5000,
          }).done,
      ),
    );
    const helperPid = Number(yield* Effect.promise(() => NodeFSP.readFile(helperFile, "utf8")));
    expect(helperPid).toBeGreaterThan(0);
    try {
      expect(answer?.drained).toBe(true);
      expect(answer?.timedOut).toBe(true);
      expect(alive(answer!.pid)).toBe(false);
      if (alive(helperPid)) {
        // Independent kernel witness: an unreaped child has exited and cannot resume writing.
        const { stdout } = yield* Effect.promise(() =>
          exec("/bin/ps", ["-A", "-o", "pid=", "-o", "stat="], { timeout: 5000 }),
        );
        const state = stdout
          .split("\n")
          .map((row) => row.trim().split(/\s+/u))
          .find(([pid]) => Number(pid) === helperPid)?.[1];
        expect(state === undefined || state.startsWith("Z")).toBe(true);
      }
      expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", f.input.ref]))).toBe(f.first);
    } finally {
      if (alive(helperPid)) {
        try {
          process.kill(helperPid, "SIGKILL");
        } catch {
          /* Captured helper already exited. */
        }
      }
    }
  }),
);

it.live("a controlled parent loss leaves a bounded writer receipt that takeover must drain", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.promise(() =>
      NodeFSP.writeFile(NodePath.join(f.remote, "hooks/pre-receive"), "#!/bin/sh\nsleep 30\n", {
        mode: 0o700,
      }),
    );
    const witness = NodePath.join(f.directory, "parent-loss.json");
    yield* credentialed((credential) =>
      Effect.promise(async () => {
        const module = new URL("./gitPushChild.ts", import.meta.url).href;
        const script = `const {startGitChild}=await import(${JSON.stringify(module)}); let input=''; for await (const chunk of process.stdin) input+=chunk; const owned=startGitChild(JSON.parse(input)); process.stdout.write(JSON.stringify({pid:owned.child.pid})+'\\n'); await owned.done;`;
        const parent = NodeChildProcess.spawn(
          process.execPath,
          ["--input-type=module", "-e", script],
          {
            stdio: "pipe",
            env: { PATH: "/usr/bin:/bin" },
          },
        );
        parent.stderr.resume();
        const launched = new Promise<number>((resolve, reject) => {
          parent.once("error", reject);
          parent.stdout.once("data", (chunk: Buffer) =>
            resolve((JSON.parse(chunk.toString()) as { pid: number }).pid),
          );
          parent.once("exit", (code) => {
            if (code !== null && code !== 0) reject(new Error("Parent launch failed"));
          });
        });
        const request: GitChildRequest = {
          mode: "push",
          directory: f.directory,
          url: f.remote,
          ref: f.input.ref,
          sha: f.second,
          before: f.first,
          credential,
          witness,
          deadlineMs: 500,
        };
        parent.stdin.end(JSON.stringify(request));
        const supervisorPid = await launched;
        expect(supervisorPid).toBeGreaterThan(0);
        const closed = new Promise<void>((resolve) => parent.once("close", () => resolve()));
        parent.kill("SIGKILL");
        await closed;
        const answer = await terminalReceipt(witness);
        expect(answer.supervisorPid).toBe(supervisorPid);
        expect(answer.timedOut).toBe(true);
        expect(answer.drained).toBe(true);
        expect(alive(answer.pid)).toBe(false);
      }),
    );
    expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", f.input.ref]))).toBe(f.first);
  }),
);

it.live(
  "actual Git argv, auth environment and bounded logs contain no credential marker or unsafe force form",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      let authenticated = 0;
      let inspected = false;
      let safeArgs = false;
      const witness = NodePath.join(f.directory, "authenticated.json");
      yield* Effect.promise(() => git(f.remote, ["config", "http.receivepack", "true"]));
      const server = NodeHttp.createServer(async (request, response) => {
        if (
          request.headers.authorization !==
          `Basic ${Buffer.from("x-access-token:credential-marker").toString("base64")}`
        ) {
          response.writeHead(401, { "www-authenticate": 'Basic realm="disposable"' }).end();
          return;
        }
        authenticated++;
        const current = JSON.parse(await NodeFSP.readFile(witness, "utf8")) as { pid: number };
        const observed = (await exec("ps", ["eww", "-p", String(current.pid), "-o", "command="]))
          .stdout;
        inspected =
          !observed.includes("credential-marker") &&
          !observed.includes("GIT_TRACE") &&
          observed.includes("GIT_ASKPASS=");
        safeArgs =
          observed.includes(`--force-with-lease=${f.input.ref}:${f.first}`) &&
          !observed.includes(" --force ") &&
          !observed.includes(" --force-with-lease ") &&
          !observed.includes(`+${f.second}`);
        const url = new URL(request.url!, "http://localhost");
        const backend = NodeChildProcess.spawn("git", ["http-backend"], {
          env: {
            PATH: "/usr/bin:/bin",
            GIT_PROJECT_ROOT: f.root,
            GIT_HTTP_EXPORT_ALL: "1",
            PATH_INFO: url.pathname,
            QUERY_STRING: url.search.slice(1),
            REQUEST_METHOD: request.method!,
            CONTENT_TYPE: request.headers["content-type"] ?? "",
            REMOTE_USER: "x-access-token",
          },
          stdio: "pipe",
        });
        request.pipe(backend.stdin);
        backend.stderr.resume();
        const chunks: Buffer[] = [];
        backend.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        backend.once("close", () => {
          const data = Buffer.concat(chunks);
          const split = data.indexOf("\r\n\r\n");
          const headers = data.subarray(0, split).toString();
          for (const header of headers.split("\r\n")) {
            const colon = header.indexOf(":");
            if (colon < 0) continue;
            if (header.startsWith("Status:"))
              response.statusCode = Number(
                header
                  .slice(colon + 1)
                  .trim()
                  .split(" ")[0],
              );
            else response.setHeader(header.slice(0, colon), header.slice(colon + 1).trim());
          }
          response.end(data.subarray(split + 4));
        });
      });
      yield* Effect.promise(
        () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
      );
      try {
        const port = (server.address() as import("node:net").AddressInfo).port;
        const answer = yield* credentialed((credential) =>
          Effect.promise(async () => {
            const owned = startGitChild({
              mode: "push",
              directory: f.directory,
              url: `http://127.0.0.1:${port}/remote.git`,
              ref: f.input.ref,
              sha: f.second,
              before: f.first,
              credential: {
                ...credential,
                args: [...credential.args, "-c", "protocol.http.allow=always"],
              },
              witness,
              deadlineMs: 5000,
            });
            return owned.done;
          }),
        );
        expect(answer?.code).toBe(0);
        expect(answer?.drained).toBe(true);
        expect(authenticated).toBeGreaterThan(0);
        expect(inspected).toBe(true);
        expect(safeArgs).toBe(true);
        expect((answer!.stdout + answer!.stderr).includes("credential-marker")).toBe(false);
        expect(answer!.stdout.length + answer!.stderr.length).toBeLessThanOrEqual(16384);
        expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", f.input.ref]))).toBe(
          f.second,
        );
      } finally {
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        );
      }
    }),
);

it.live(
  "a refused pre-submit ref read retains the host's words without inventing an uncertain write",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(fixture);
      const url = NodePath.join(f.root, "missing.git");
      const previous: PushEvidence = {
        phase: "preflight",
        processes: [],
        version: null,
        nextActor: "hq",
        nextAction: "Verify the destination",
        remote: url,
        identity: f.input.identity,
        ref: f.input.ref,
        sha: f.second,
        keptAt: f.input.keptAt,
        before: null,
        writerDrained: true,
      };
      const result = yield* deliverRef(
        { ...f.input, url, confirmed: null },
        () => Effect.void,
        previous,
      );
      expect(result.state).toBe("refused");
      expect(result.reason).toContain("does not appear to be a git repository");
      expect(result.evidence.witness).toBeUndefined();
      expect(result.evidence.writerDrained).toBe(true);
      expect(yield* Effect.promise(() => git(f.remote, ["rev-parse", f.input.ref]))).toBe(f.first);
    }),
);
