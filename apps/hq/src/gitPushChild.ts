// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off preferSchemaOverJson:off -- standalone child process protocol and child-local deadline.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import type { GitCredentialProcess } from "./gitAskpass.ts";

export interface GitChildRequest {
  readonly mode: "read" | "push" | "clone";
  readonly directory: string;
  readonly url: string;
  readonly ref: string;
  readonly sha: string;
  readonly before: string | null;
  readonly credential: GitCredentialProcess;
  readonly witness: string;
  readonly deadlineMs: number;
}
export interface GitChildAnswer {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly drained: boolean;
  readonly pid: number | null;
  readonly supervisorPid: number;
}

/** Serialized into the HQ bundle: no source-file path or parent lifetime is required. */
async function supervise() {
  process.stdout.on("error", () => {});
  const cp = process.getBuiltinModule("node:child_process");
  const fs = process.getBuiltinModule("node:fs/promises");
  const path = process.getBuiltinModule("node:path");
  let request!: GitChildRequest;
  let active: import("node:child_process").ChildProcessWithoutNullStreams | undefined;
  let timedOut = false;
  let drained = true;
  let lastPid: number | null = null;
  const kill = () => {
    timedOut = true;
    if (active?.pid !== undefined) {
      try {
        process.kill(-active.pid, "SIGKILL");
      } catch {
        /* Already drained. */
      }
    }
  };
  const attemptMs = () => Math.max(1, Math.min(request.deadlineMs, 60_000));
  // Bounds even a parent that dies before finishing the input handoff.
  let timer = setTimeout(kill, 60_000);
  process.on("SIGTERM", kill);
  const exists = (pid: number) => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  };
  // Linux can retain exited group members until their new parent reaps them. A signal probe
  // detects those PID records too; only a live member can still write to the remote.
  const stopped = async (pid: number) => {
    if (!exists(pid)) return true;
    try {
      for (const entry of await fs.readdir("/proc")) {
        if (!/^[0-9]+$/u.test(entry)) continue;
        let stat: string;
        try {
          stat = await fs.readFile(`/proc/${entry}/stat`, "utf8");
        } catch (error) {
          // A process that exits mid-scan is gone, not a live member.
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ESRCH") continue;
          return false;
        }
        const fields = stat
          .slice(stat.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/u);
        if (fields.length < 3 || !/^[0-9]+$/u.test(fields[2]!)) return false;
        if (Number(fields[2]) === pid && fields[0] !== "Z" && fields[0] !== "X") return false;
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      // Hosts without procfs expose the same kernel group/state proof through ps.
      try {
        const states = cp.execFileSync("/bin/ps", ["-A", "-o", "pgid=", "-o", "stat="], {
          encoding: "utf8",
          timeout: attemptMs(),
          maxBuffer: 64 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        });
        return states.split("\n").every((row) => {
          if (row.trim() === "") return true;
          const [group, state] = row.trim().split(/\s+/u);
          if (group === undefined || !/^[0-9]+$/u.test(group) || state === undefined) return false;
          return Number(group) !== pid || /^[ZX]/u.test(state);
        });
      } catch {
        return false;
      }
    }
  };
  // SIGKILL is delivered before it is acted on: a member between the signal and its exit still
  // reads live. Re-read the kernel until the group is gone; the attempt's own deadline bounds a
  // member stuck in uninterruptible sleep, which stays recorded undrained.
  const drain = async (pid: number) => {
    const bound = Date.now() + attemptMs();
    while (!(await stopped(pid))) {
      if (Date.now() >= bound) return false;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return true;
  };
  // A reader racing Git (recovery, the parent, a remote under test) sees a whole record or the
  // previous one, never the empty file a truncating write leaves for a moment.
  const record = async (value: object) => {
    await fs.writeFile(`${request.witness}.tmp`, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(`${request.witness}.tmp`, request.witness);
  };
  let secret = "";
  const safe = (value: string) =>
    (secret ? value.split(secret).join("[redacted]") : value)
      .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gu, "https://[redacted]@")
      .slice(0, 8192);
  const run = async (args: string[]): Promise<GitChildAnswer> => {
    if (timedOut)
      return {
        code: -1,
        stdout: "",
        stderr: "Git attempt deadline passed",
        timedOut,
        drained,
        pid: lastPid,
        supervisorPid: process.pid,
      };
    const child = cp.spawn(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "gc.auto=0",
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        // Only absolute local paths from the executor/test boundary use the local protocol.
        ...(path.isAbsolute(request.url) ? ["-c", "protocol.file.allow=always"] : []),
        ...request.credential.args,
        ...args,
      ],
      {
        cwd: request.directory,
        env: {
          PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/local/bin`,
          HOME: request.directory,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_NO_REPLACE_OBJECTS: "1",
          LC_ALL: "C",
          ...request.credential.env,
        },
        stdio: "pipe",
        detached: true,
      },
    );
    active = child;
    lastPid = child.pid ?? null;
    const completion = new Promise<number>((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (value) => resolve(value ?? -1));
    });
    child.stdin.on("error", () => {});
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    let outputExceeded = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > 16384) outputExceeded = true;
      else if (!outputExceeded) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length + chunk.length > 16384) outputExceeded = true;
      else if (!outputExceeded) stderr += chunk.toString();
    });
    await record({ phase: "writing", pid: lastPid, supervisorPid: process.pid, drained: false });
    const code = await completion;
    // A helper that detached its output is still a writer. Stop only this captured group
    // before proving there are no live members, including on kernels retaining exited PIDs.
    if (lastPid !== null && exists(lastPid)) kill();
    drained = lastPid === null || (await drain(lastPid));
    active = undefined;
    return {
      code,
      stdout: outputExceeded ? "" : safe(stdout),
      stderr: outputExceeded ? "Git output exceeded the bounded log limit" : safe(stderr),
      timedOut,
      drained,
      pid: lastPid,
      supervisorPid: process.pid,
    };
  };
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (input.length > 64 * 1024) throw new Error("Child request too large");
    }
    request = JSON.parse(input) as GitChildRequest;
    clearTimeout(timer);
    timer = setTimeout(kill, attemptMs());
    secret = await fs.readFile(
      path.join(path.dirname(request.credential.env.GIT_ASKPASS), "credential"),
      "utf8",
    );
    let answer: GitChildAnswer;
    if (request.mode === "clone") {
      answer = await run(["clone", "--bare", "--", request.url, "snapshot.git"]);
    } else if (request.mode === "read") {
      answer = await run(["ls-remote", "--refs", "--", request.url, request.ref]);
    } else {
      const checked = await run(["check-ref-format", request.ref]);
      if (
        checked.code !== 0 ||
        !request.ref.startsWith("refs/heads/") ||
        !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(request.sha) ||
        (request.before !== null && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(request.before))
      ) {
        answer = { ...checked, code: 1, stderr: "Invalid fixed Git destination" };
      } else {
        const ancestry =
          request.before === null
            ? undefined
            : await run(["merge-base", "--is-ancestor", request.before, request.sha]);
        if (ancestry !== undefined && ancestry.code !== 0) {
          answer = {
            ...ancestry,
            stderr: "The observed remote tip is not an ancestor of the fixed commit",
          };
        } else {
          // The remote must still hold the observed tip (null: no branch). The push carries no
          // force form, so a remote moving after this read can only be fast-forwarded.
          const read = await run(["ls-remote", "--refs", "--", request.url, request.ref]);
          const tip =
            read.stdout
              .split("\n")
              .find((line) => line.split("\t")[1] === request.ref)
              ?.split("\t")[0] ?? null;
          answer =
            read.code !== 0
              ? read
              : tip !== request.before
                ? {
                    ...read,
                    code: 1,
                    stdout: `!\t${request.sha}:${request.ref}\t[rejected] (stale info)\n`,
                  }
                : await run([
                    "push",
                    "--porcelain",
                    "--",
                    request.url,
                    `${request.sha}:${request.ref}`,
                  ]);
        }
      }
    }
    // Atomic receipt comes only after the entire captured process group has stopped.
    await record(answer);
    process.stdout.write(JSON.stringify(answer));
  } catch {
    kill();
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    if (request?.credential && drained) {
      await fs.rm(path.join(path.dirname(request.credential.env.GIT_ASKPASS), "credential"), {
        force: true,
      });
      await fs.rm(request.credential.env.GIT_ASKPASS, { force: true });
    }
  }
}

/** The parent owns only this captured supervisor; the supervisor owns Git's whole group. */
export const startGitChild = (request: GitChildRequest) => {
  const child = NodeChildProcess.spawn(
    process.execPath,
    ["--input-type=module", "-e", `(${supervise.toString()})()`],
    {
      env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
      stdio: "pipe",
    },
  );
  child.stdin.on("error", () => {});
  child.stdout.resume();
  child.stderr.resume();
  const done = new Promise<GitChildAnswer | undefined>((resolve) => {
    child.on("error", () => resolve(undefined));
    child.on("close", async () => {
      try {
        resolve(JSON.parse(await NodeFSP.readFile(request.witness, "utf8")) as GitChildAnswer);
      } catch {
        resolve(undefined);
      }
    });
  });
  child.stdin.end(JSON.stringify(request));
  return { child, done };
};
