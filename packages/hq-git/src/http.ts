// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
import type * as NodeHttp from "node:http";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeZlib from "node:zlib";
import {
  GitError,
  type GitEvent,
  type HqGitOptions,
  type Principal,
  type RefUpdate,
  type Repo,
} from "./api.ts";
import { GitRunner, converge, terminate } from "./git.ts";
import { HttpError, gitTarget, pkt, readPush, refusalReport } from "./protocol.ts";
import { PushReport } from "./report.ts";
import { allowRefUpdate } from "./rules.ts";

async function* body(req: NodeHttp.IncomingMessage, limit: number): AsyncGenerator<Buffer> {
  const encoding = req.headers["content-encoding"];
  if (encoding && !["identity", "gzip", "x-gzip"].includes(encoding))
    throw new HttpError(415, "Unsupported content encoding");
  const decoded =
    encoding === "gzip" || encoding === "x-gzip" ? req.pipe(NodeZlib.createGunzip()) : req;
  let count = 0;
  try {
    for await (const chunk of decoded) {
      const bytes = Buffer.from(chunk as Uint8Array);
      count += bytes.length;
      if (count > limit) throw new HttpError(413, "Request exceeds limit");
      yield bytes;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Could not decode git request");
  }
}

export const makeHandler = (
  options: HqGitOptions,
  git: GitRunner,
  locate: (repo: Repo) => Promise<string | null>,
  emit: (event: GitEvent) => Promise<void>,
): NodeHttp.RequestListener => {
  const prefix = options.pathPrefix ?? "/git";
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(prefix) || prefix.endsWith("/")) {
    throw new GitError({
      operation: "handler",
      reason: "invalid_config",
      message: "Invalid git path prefix",
    });
  }
  const decide = async (principal: Principal, repo: Repo, updates: ReadonlyArray<RefUpdate>) => {
    const decisions = await Promise.all(
      updates.map((update) => allowRefUpdate(principal, repo, update, options.lookupChange)),
    );
    if (!options.authorize || decisions.some((decision) => !decision.allowed)) return decisions;
    // Every update passed the built-in rules, so Core's answer can only narrow them.
    const narrowed = await options.authorize(principal, repo, updates);
    if (
      narrowed.length !== updates.length ||
      narrowed.some(
        (decision) =>
          typeof decision.allowed !== "boolean" ||
          (!decision.allowed && typeof decision.reason !== "string"),
      )
    ) {
      throw new HttpError(500, "Invalid write authorization result");
    }
    return narrowed;
  };
  const serve = async (req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) => {
    const abort = new AbortController();
    let settled = false;
    // Disconnect or deadline stops git, except receive-pack once it holds the whole push: cutting
    // it between its pack and its ref updates would only leave debris.
    const stop = () => {
      if (settled || abort.signal.aborted) return;
      abort.abort();
      req.destroy();
    };
    const deadline = AbortSignal.timeout(options.requestTimeoutMs ?? 30 * 60 * 1000);
    deadline.addEventListener("abort", stop);
    req.on("aborted", stop);
    res.on("close", stop);
    let input: AsyncGenerator<Buffer> | undefined;
    // A refused push still reads its bounded pack, so the client gets to read the per-ref report;
    // the deadline still applies once the handler has answered.
    const drain = (rest: AsyncGenerator<Buffer>) => {
      deadline.addEventListener("abort", () => req.destroy(), { once: true });
      void (async () => {
        for await (const _chunk of rest) {
          /* Drop the remaining pack. */
        }
      })().catch(() => req.destroy());
    };
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    try {
      const target = gitTarget(prefix, req.url ?? "");
      if (!target) throw new HttpError(404, "Repository not found");
      const { repo, operation, service } = target;
      const principal = await options.authenticate(req);
      if (!principal) throw new HttpError(401, "Authentication required");
      if (!(await options.canRead(principal, repo)))
        throw new HttpError(403, "App read access refused");
      const dir = await locate(repo);
      if (!dir) throw new HttpError(404, "Repository not found");
      const advertise = operation === "info/refs";
      if (req.method !== (advertise ? "GET" : "POST"))
        throw new HttpError(405, "Invalid git request method");
      if (service === null) throw new HttpError(400, "Invalid git service");
      const command = service.slice(4);
      const protocol =
        service === "git-upload-pack" && req.headers["git-protocol"] === "version=2"
          ? "version=2"
          : "version=1";
      const env = { GIT_PROTOCOL: protocol };
      if (advertise) {
        await converge(git, dir, abort.signal);
        const refs = await git.run([command, "--stateless-rpc", "--advertise-refs", dir], {
          env,
          signal: abort.signal,
        });
        res.setHeader("Content-Type", `application/x-${service}-advertisement`);
        res.end(
          service === "git-upload-pack" && protocol === "version=2"
            ? refs
            : Buffer.concat([pkt(`# service=${service}\n`), Buffer.from("0000"), refs]),
        );
        return;
      }
      if (
        req.headers["content-type"]?.split(";")[0]?.trim() !== `application/x-${service}-request`
      ) {
        throw new HttpError(415, "Invalid git request content type");
      }
      input = body(req, service === "git-receive-pack" ? 256 * 1024 * 1024 : 8 * 1024 * 1024);
      let replay: Buffer | undefined;
      let updates: ReadonlyArray<RefUpdate> = [];
      let report: PushReport | undefined;
      res.setHeader("Content-Type", `application/x-${service}-result`);
      if (service === "git-receive-pack") {
        const push = await readPush(input);
        if (push.updates.length === 0) {
          drain(input);
          res.end();
          return;
        }
        const decisions = await decide(principal, repo, push.updates);
        if (decisions.some((decision) => !decision.allowed)) {
          drain(input);
          res.end(refusalReport(push.updates, decisions, push.capabilities));
          return;
        }
        replay = push.replay;
        updates = push.updates;
        report = new PushReport(push.capabilities);
      }
      if (abort.signal.aborted) return;
      await converge(git, dir, abort.signal);
      const process = git.start([command, "--stateless-rpc", dir], { env, signal: abort.signal });
      const push = command === "receive-pack";
      async function* feed() {
        if (replay) yield replay;
        yield* input!;
        settled = push;
      }
      const send = NodeStreamPromises.pipeline(
        NodeStream.Readable.from(feed()),
        process.child.stdin,
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
      });
      // A link may be published as soon as the caller sees success. Keep the bounded report
      // until Core has recorded the applied refs, so a readable head always precedes that link.
      const pushReport: Buffer[] = [];
      let reportBytes = 0;
      const output = push
        ? (async () => {
            for await (const chunk of process.child.stdout) {
              const bytes = Buffer.from(chunk as Uint8Array);
              report?.feed(bytes);
              reportBytes += bytes.length;
              if (reportBytes > 8 * 1024 * 1024)
                throw new HttpError(500, "Git report exceeds limit");
              pushReport.push(bytes);
            }
          })()
        : NodeStreamPromises.pipeline(process.child.stdout, res, { end: false });
      // receive-pack can exit nonzero after sending a valid report-status; preserve that report.
      try {
        await Promise.all([send, output]);
        if (push) {
          const success = await process.done.then(
            () => true,
            () => false,
          );
          let applied = updates.filter((update) => report?.ok.has(update.ref));
          // Without report-status there is no per-ref report. Verify refs only on process success.
          if (success && !report?.requested) {
            applied = [];
            for (const update of updates) {
              const current = await git.run([
                "-C",
                dir,
                "for-each-ref",
                "--format=%(refname) %(objectname)",
                update.ref,
              ]);
              if (current.toString().split("\n").includes(`${update.ref} ${update.newSha}`))
                applied.push(update);
            }
          }
          if (applied.length) await emit({ kind: "pushed", repo, updates: applied });
          // Only Core may push main or tags; its pushes report like the layer's own writes.
          for (const { ref, oldSha, newSha } of applied) {
            if (ref === "refs/heads/main")
              await emit({
                kind: "main_moved",
                repo,
                old: /^0+$/.test(oldSha) ? null : oldSha,
                new: newSha,
                by: "push",
              });
            else if (ref.startsWith("refs/tags/")) {
              const target = await git
                .run(["-C", dir, "rev-parse", "--verify", "--end-of-options", `${newSha}^{}`])
                .then(
                  (peeled) => peeled.toString().trim(),
                  () => newSha,
                );
              await emit({
                kind: "tagged",
                repo,
                name: ref.slice("refs/tags/".length),
                sha: target,
              });
            }
          }
        } else await process.done;
        res.end(push ? Buffer.concat(pushReport) : undefined);
      } finally {
        terminate(process.child);
        await process.done.catch(() => {});
      }
    } catch (error) {
      if (res.headersSent) res.destroy();
      else {
        res.statusCode = error instanceof HttpError ? error.status : 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        if (res.statusCode === 401) res.setHeader("WWW-Authenticate", 'Basic realm="hq-git"');
        // Never read an unwanted body to keep the connection alive: answer, then close it.
        res.setHeader("Connection", "close");
        res.end(`${error instanceof HttpError ? error.message : "Git request failed"}\n`, () =>
          req.socket.destroy(),
        );
      }
    } finally {
      deadline.removeEventListener("abort", stop);
      req.off("aborted", stop);
      res.off("close", stop);
    }
  };
  return (req, res) => {
    void serve(req, res);
  };
};
