/**
 * threadToolsMcp — a thread profile's tools as an MCP server any agent can
 * spawn.
 *
 * Claude's SDK hosts a profile's tools in process; every other agent can only
 * reach an MCP server it starts itself. So this serves the tools on a loopback
 * TCP port for the life of the caller's scope, newline-delimited JSON-RPC
 * (MCP's stdio framing), and hands back a stdio server entry whose command is
 * a few lines of this same runtime that pipe the agent's stdin and stdout to
 * that port. The first line the pipe sends is a per-server token, so another
 * local process that finds the port reaches nothing.
 *
 * One of the inbound SPI files (`spi.md` §1a): it imports nothing from
 * `provider/**`.
 *
 * @module threadToolsMcp
 */
import * as NodeNet from "node:net";
import { randomBytes } from "@noble/hashes/utils";

import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import type * as Scope from "effect/Scope";

import type { ThreadTool } from "./threadToolPolicy.ts";

/** An MCP server an agent starts over stdio, as ACP's `session/new` takes it. */
export interface ThreadToolsStdioServer {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

/** The MCP revision this server speaks when the client names none. */
const PROTOCOL_VERSION = "2025-06-18";

const TOKEN_VARIABLE = "MATE_THREAD_TOOLS_TOKEN";
const PORT_VARIABLE = "MATE_THREAD_TOOLS_PORT";

/**
 * The pipe the agent runs: stdin to the port after the token, the port to
 * stdout, gone when either side closes. Plain CommonJS for `-e`.
 */
const PIPE_SOURCE = [
  `const s=require("node:net").connect(Number(process.env.${PORT_VARIABLE}),"127.0.0.1");`,
  `s.on("connect",()=>{s.write(process.env.${TOKEN_VARIABLE}+"\\n");process.stdin.pipe(s);});`,
  `s.pipe(process.stdout);`,
  `s.on("close",()=>process.exit(0));s.on("error",()=>process.exit(1));`,
  `process.stdin.on("end",()=>s.end());`,
].join("");

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: JsonRpcId;
  readonly method?: unknown;
  readonly params?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const result = (id: JsonRpcId, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/**
 * One JSON-RPC message's answer, or `undefined` for a notification. The
 * tools run as the profile gives them; a tool that fails answers as an
 * error the model reads, never a protocol error.
 */
export const answerMcpMessage = (
  name: string,
  tools: ReadonlyArray<ThreadTool>,
  message: unknown,
): Effect.Effect<unknown> =>
  Effect.gen(function* () {
    if (!isRecord(message)) return failure(null, -32600, "Invalid Request");
    const request = message as JsonRpcRequest;
    const id = request.id;
    if (id === undefined) return undefined;
    const params = isRecord(request.params) ? request.params : {};
    switch (request.method) {
      case "initialize":
        return result(id, {
          protocolVersion:
            typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name, version: "1.0.0" },
        });
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
      case "tools/call": {
        const tool = tools.find((candidate) => candidate.name === params.name);
        if (tool === undefined) {
          return result(id, {
            content: [{ type: "text", text: `There is no tool ${String(params.name)}.` }],
            isError: true,
          });
        }
        const answer = yield* tool
          .run(params.arguments ?? {})
          .pipe(
            Effect.catchCause(() =>
              Effect.succeed({ text: `${tool.name} failed.`, isError: true }),
            ),
          );
        return result(id, {
          content: [{ type: "text", text: answer.text }],
          isError: answer.isError,
        });
      }
      default:
        return failure(id, -32601, `Method not found: ${String(request.method)}`);
    }
  });

/**
 * Serves `tools` as MCP server `name` until the scope closes, and returns the
 * stdio entry an agent starts to reach it.
 */
export const serveThreadTools = (
  name: string,
  tools: ReadonlyArray<ThreadTool>,
): Effect.Effect<ThreadToolsStdioServer, never, Scope.Scope> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const token = Hex.encode(randomBytes(24));
    const sockets = new Set<NodeNet.Socket>();
    const server = NodeNet.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      socket.setEncoding("utf8");
      let buffered = "";
      let admitted = false;
      // Answers go out in the order their requests came in.
      let queue: Promise<void> = Promise.resolve();
      socket.on("data", (chunk: string) => {
        buffered += chunk;
        let newline = buffered.indexOf("\n");
        while (newline >= 0) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf("\n");
          if (!admitted) {
            if (line !== token) {
              socket.destroy();
              return;
            }
            admitted = true;
            continue;
          }
          if (line.length === 0) continue;
          let message: unknown;
          try {
            message = JSON.parse(line);
          } catch {
            socket.write(`${JSON.stringify(failure(null, -32700, "Parse error"))}\n`);
            continue;
          }
          queue = queue.then(() =>
            Effect.runPromiseWith(services)(answerMcpMessage(name, tools, message)).then(
              (answer) => {
                if (answer !== undefined && !socket.destroyed) {
                  socket.write(`${JSON.stringify(answer)}\n`);
                }
              },
            ),
          );
        }
      });
    });
    const port = yield* Effect.acquireRelease(
      Effect.callback<number>((resume) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resume(Effect.succeed(typeof address === "object" && address ? address.port : 0));
        });
      }),
      () =>
        Effect.sync(() => {
          for (const socket of sockets) socket.destroy();
          server.close();
        }),
    );
    return {
      name,
      command: process.execPath,
      args: ["-e", PIPE_SOURCE],
      env: [
        { name: PORT_VARIABLE, value: String(port) },
        { name: TOKEN_VARIABLE, value: token },
        // The server may run inside Electron, whose binary is node only so.
        { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      ],
    };
  });
