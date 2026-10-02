// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
import type * as NodeHttp from "node:http";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodeZlib from "node:zlib";
import { GitError, type HqGitOptions, type Principal, type RefUpdate, type Repo } from "./api.ts";
import { GitRunner, converge, terminate } from "./git.ts";
import { HttpError, pkt, readPush, refusalReport } from "./protocol.ts";
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
      // Match the raw path: a URL parser would resolve `..` and `%2e%2e` into another repository.
      const target = req.url ?? "";
      const mark = target.includes("?") ? target.indexOf("?") : target.length;
      const [path, query] = [target.slice(0, mark), target.slice(mark + 1)];
      if (!path.startsWith(`${prefix}/`)) throw new HttpError(404, "Repository not found");
      const match =
        /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(
          path.slice(prefix.length + 1),
        );
      if (!match) throw new HttpError(404, "Repository not found");
      const repo = { appId: match[1]!, id: match[2]! };
      const operation = match[3]!;
      const principal = await options.authenticate(req);
      if (!principal) throw new HttpError(401, "Authentication required");
      if (!(await options.canRead(principal, repo)))
        throw new HttpError(403, "App read access refused");
      const dir = await locate(repo);
      if (!dir) throw new HttpError(404, "Repository not found");
      const advertise = operation === "info/refs";
      if (req.method !== (advertise ? "GET" : "POST"))
        throw new HttpError(405, "Invalid git request method");
      const service = advertise ? new URLSearchParams(query).get("service") : operation;
      if (service !== "git-upload-pack" && service !== "git-receive-pack")
        throw new HttpError(400, "Invalid git service");
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
      // receive-pack keeps writing even to a departed client, so it never dies of a closed pipe.
      const output = push
        ? (async () => {
            for await (const chunk of process.child.stdout) if (!res.destroyed) res.write(chunk);
          })()
        : NodeStreamPromises.pipeline(process.child.stdout, res, { end: false });
      // receive-pack can exit nonzero after sending a valid report-status; preserve that report.
      try {
        await Promise.all([send, output]);
        if (push) await process.done.catch(() => {});
        else await process.done;
        res.end();
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
