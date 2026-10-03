// The pipe is run as an agent runs it: a plain child process with its env.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ThreadTool } from "./threadToolPolicy.ts";
import { serveThreadTools } from "./threadToolsMcp.ts";

const report: ThreadTool = {
  name: "crew_report",
  description: "Report your task.",
  inputSchema: { type: "object", properties: { status: { type: "string" } } },
  run: (input) =>
    Effect.succeed({
      text: `reported ${(input as { status?: string }).status ?? "nothing"}`,
      isError: false,
    }),
};
const broken: ThreadTool = {
  name: "crew_broken",
  description: "Fails.",
  inputSchema: { type: "object" },
  run: () => Effect.die("boom"),
};

/** Runs the server's stdio entry as an agent would, and talks MCP over it. */
const asAgent = (
  server: {
    command: string;
    args: ReadonlyArray<string>;
    env: ReadonlyArray<{ name: string; value: string }>;
  },
  messages: ReadonlyArray<unknown>,
) =>
  Effect.promise(
    () =>
      new Promise<ReadonlyArray<unknown>>((resolve, reject) => {
        const child = NodeChildProcess.spawn(server.command, [...server.args], {
          env: {
            ...process.env,
            ...Object.fromEntries(server.env.map((variable) => [variable.name, variable.value])),
          },
          stdio: ["pipe", "pipe", "inherit"],
        });
        const expected = messages.filter(
          (message) => (message as { id?: unknown }).id !== undefined,
        ).length;
        const answers: Array<unknown> = [];
        let buffered = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          buffered += chunk;
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) answers.push(JSON.parse(line));
          if (answers.length >= expected) {
            child.stdin.end();
            child.kill();
            resolve(answers);
          }
        });
        child.on("error", reject);
        for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
      }),
  );

describe("serveThreadTools", () => {
  it.live("serves a profile's tools to an agent that spawns its stdio entry", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* serveThreadTools("crew", [report, broken]);
        const answers = yield* asAgent(server, [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-03-26" },
          },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "crew_report", arguments: { status: "done" } },
          },
          { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "crew_broken" } },
          { jsonrpc: "2.0", id: 5, method: "resources/list" },
        ]);
        expect(answers).toEqual([
          {
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "crew", version: "1.0.0" },
            },
          },
          {
            jsonrpc: "2.0",
            id: 2,
            result: {
              tools: [
                {
                  name: "crew_report",
                  description: "Report your task.",
                  inputSchema: report.inputSchema,
                },
                { name: "crew_broken", description: "Fails.", inputSchema: { type: "object" } },
              ],
            },
          },
          {
            jsonrpc: "2.0",
            id: 3,
            result: { content: [{ type: "text", text: "reported done" }], isError: false },
          },
          {
            jsonrpc: "2.0",
            id: 4,
            result: { content: [{ type: "text", text: "crew_broken failed." }], isError: true },
          },
          {
            jsonrpc: "2.0",
            id: 5,
            error: { code: -32601, message: "Method not found: resources/list" },
          },
        ]);
      }),
    ),
  );

  it.live("answers nothing to a connection without the server's token", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* serveThreadTools("crew", [report]);
        const port = Number(server.env.find((variable) => variable.name.endsWith("PORT"))!.value);
        const closed = yield* Effect.promise(
          () =>
            new Promise<string>((resolve) => {
              const socket = NodeNet.connect(port, "127.0.0.1", () => {
                socket.write("not-the-token\n");
                socket.write(
                  `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`,
                );
              });
              let received = "";
              socket.on("data", (chunk) => (received += chunk.toString()));
              socket.on("close", () => resolve(received));
            }),
        );
        expect(closed).toBe("");
      }),
    ),
  );
});
