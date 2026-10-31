// @effect-diagnostics nodeBuiltinImport:off -- private native-tool HTTP execution boundary.
import * as NodeHttp from "node:http";
import { randomBytes } from "@noble/hashes/utils";
import { ProviderDriverKind, type ProviderInstanceId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import type * as Scope from "effect/Scope";
import type { ToolInvocationExecute, ToolInvocationIdentity } from "./toolInvocation.ts";

export interface OpenCodeExecutionSession {
  readonly threadId: ThreadId;
  readonly prepare: ToolInvocationExecute;
  readonly execute: ToolInvocationExecute;
  readonly resolveTurn: (identity: ToolInvocationIdentity) => Effect.Effect<string | undefined>;
}
export interface OpenCodeToolExecution {
  readonly url: string;
  readonly token: string;
  readonly isManaged: (sessionID: string) => boolean;
  readonly markManaged: (sessionID: string) => void;
  readonly registerSession: (sessionID: string, session: OpenCodeExecutionSession) => () => void;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nativeID = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 1024;

/** One provider owns the socket, session routes and all executing invocations. */
export const serveOpenCodeToolExecution = (
  instanceId: ProviderInstanceId,
): Effect.Effect<OpenCodeToolExecution, never, Scope.Scope> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const token = Hex.encode(randomBytes(32));
    const sessions = new Map<string, OpenCodeExecutionSession>();
    const managed = new Set<string>();
    const active = new Map<AbortController, Promise<void>>();
    let closed = false;
    const reply = (res: NodeHttp.ServerResponse, status: number, value: unknown) => {
      if (!res.destroyed) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      }
    };
    const server = NodeHttp.createServer((req, res) => {
      if (
        closed ||
        req.method !== "POST" ||
        (req.url !== "/invoke" && req.url !== "/prepare" && req.url !== "/policy") ||
        req.headers.authorization !== `Bearer ${token}`
      ) {
        reply(res, 403, { code: "invocation_refused" });
        return;
      }
      if (active.size >= 16) {
        reply(res, 503, { code: "invocation_busy" });
        return;
      }
      const abort = new AbortController();
      res.once("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const pending = (async () => {
        const parts: Buffer[] = [];
        let size = 0;
        for await (const part of req) {
          const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
          size += bytes.length;
          if (size > 1024 * 1024) {
            reply(res, 413, { code: "invocation_too_large" });
            return;
          }
          parts.push(bytes);
        }
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(parts).toString("utf8"));
        } catch {
          reply(res, 400, { code: "invocation_invalid" });
          return;
        }
        if (req.url === "/policy") {
          if (!record(body) || !nativeID(body.sessionID) || Object.keys(body).length !== 1) {
            reply(res, 400, { code: "invocation_invalid" });
            return;
          }
          // Denial policy only. An unknown native child never becomes a
          // manual caller through an inferred parent or latest active run.
          reply(res, 200, {
            allowStaticWorkflow: sessions.has(body.sessionID) && !managed.has(body.sessionID),
          });
          return;
        }
        if (
          !record(body) ||
          !nativeID(body.sessionID) ||
          !nativeID(body.messageID) ||
          !nativeID(body.callID) ||
          !record(body.input) ||
          Object.keys(body).some(
            (key) => !["sessionID", "messageID", "callID", "input"].includes(key),
          )
        ) {
          reply(res, 400, { code: "invocation_invalid" });
          return;
        }
        const session = sessions.get(body.sessionID);
        if (session === undefined) {
          reply(res, 403, { code: "invocation_unknown_session" });
          return;
        }
        const identity: ToolInvocationIdentity = {
          driver: ProviderDriverKind.make("opencode"),
          instanceId,
          sessionId: body.sessionID,
          messageId: body.messageID,
          callId: body.callID,
        };
        // Resolving a parent may perform SDK I/O. The owned executor first
        // captures this exact identity; the bridge never evaluates it early.
        const answer = await Effect.runPromiseWith(services)(
          (req.url === "/prepare" ? session.prepare : session.execute)(body.input, {
            threadId: session.threadId,
            identity,
            resolveTurn: () => session.resolveTurn(identity),
          }).pipe(Effect.timeout("5 minutes")),
          { signal: abort.signal },
        );
        if (answer.text.length > 1024 * 1024) {
          reply(res, 502, { code: "invocation_answer_too_large" });
          return;
        }
        reply(res, 200, { text: answer.text, isError: answer.isError === true });
      })()
        .catch(() => reply(res, 503, { code: "invocation_unavailable" }))
        .finally(() => active.delete(abort));
      active.set(abort, pending);
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 5_000;
    const port = yield* Effect.acquireRelease(
      Effect.callback<number>((resume) => {
        server.once("error", (cause) => resume(Effect.die(cause)));
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resume(Effect.succeed(typeof address === "object" && address ? address.port : 0));
        });
      }),
      () =>
        Effect.promise(async () => {
          closed = true;
          sessions.clear();
          managed.clear();
          for (const abort of active.keys()) abort.abort();
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
          await Promise.allSettled(active.values());
        }),
    );
    return {
      url: `http://127.0.0.1:${port}/invoke`,
      token,
      isManaged: (id) => managed.has(id),
      markManaged: (id) => {
        if (closed || !sessions.has(id) || (managed.size >= 1024 && !managed.has(id)))
          throw new Error("OpenCode managed session unavailable");
        managed.add(id);
      },
      registerSession: (id, session) => {
        if (closed || !nativeID(id) || (sessions.size >= 1024 && !sessions.has(id)))
          throw new Error("OpenCode execution session unavailable");
        sessions.set(id, session);
        return () => {
          if (sessions.get(id) === session) sessions.delete(id);
        };
      },
    };
  });
