// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - drives the mock agent as a real child process over raw stdin.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { expect, it } from "vite-plus/test";

import { parseCompleteJsonLines } from "./jsonLines.ts";

const mockAgentPath = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../scripts/acp-mock-agent.ts",
);

const initialize = (id: number) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: 1, clientCapabilities: {} },
  });

it("a log file whose last line is a fragment reads as complete lines only, and the line counts once finished", () => {
  expect(parseCompleteJsonLines('{"a":1}\n{"b":')).toEqual([{ a: 1 }]);
  expect(parseCompleteJsonLines('{"b":')).toEqual([]);
  expect(parseCompleteJsonLines('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
});

it("The mock agent's request log holds one JSON line per request, however its stdin is split", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "acp-mock-log-"));
  const logPath = NodePath.join(directory, "requests.log");
  const child = NodeChildProcess.spawn(process.execPath, [mockAgentPath], {
    env: { ...process.env, T3_ACP_REQUEST_LOG_PATH: logPath },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    let output = "";
    const answered = (id: number) =>
      new Promise<void>((resolve, reject) => {
        child.once("exit", (code) => reject(new Error(`mock agent exited with ${code}`)));
        const check = () => output.includes(`"id":${id},`) || output.includes(`"id":${id}}`);
        if (check()) return resolve();
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
          if (check()) resolve();
        });
      });
    const write = (data: string) =>
      new Promise<void>((resolve, reject) =>
        child.stdin.write(data, (error) => (error ? reject(error) : resolve())),
      );

    // Once the agent is idle on stdin, each awaited write reaches it as its own read.
    const warm = answered(1);
    await write(`${initialize(1)}\n`);
    await warm;
    for (const piece of `${initialize(2)}\n`.match(/[^]{1,7}/g) ?? []) await write(piece);
    const receipt = answered(3);
    await write(`${initialize(3)}\n`);
    await receipt;

    const raw = await NodeFSP.readFile(logPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(parseCompleteJsonLines(raw).map((entry) => entry.id)).toEqual([1, 2, 3]);
  } finally {
    child.kill("SIGTERM");
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
