// @effect-diagnostics nodeBuiltinImport:off -- an external CLI fixture owns only its scenario's temp files.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { PtyAdapter } from "../src/terminal/PtyAdapter.ts";

export const CLAUDE_SCENARIO_CODE = "scenario-claude-code";

/**
 * Claude's external login source: a native process accepts a fixture code, writes a disposable
 * credential in the walker's scratch home, and answers its CLI status probe from that file.
 * The real walker commits it and records the authenticated Zerops caller. No owner or engine
 * records are authored here. The provider's real OAuth ceremony remains in its own cases.
 */
export async function scriptedClaudeSignIn(input: {
  readonly root: string;
  readonly homeDir: string;
  readonly cwd: string;
}) {
  const directory = NodePath.join(input.root, "native-bin");
  const executable = NodePath.join(directory, "claude");
  await NodeFSP.mkdir(directory, { recursive: true });
  await NodeFSP.writeFile(
    executable,
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const args = process.argv.slice(2);
const home = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, ".claude");
const credential = path.join(home, ".credentials.json");
if (args.join(" ") === "auth status") {
  const loggedIn = fs.existsSync(credential) && JSON.parse(fs.readFileSync(credential, "utf8")).scenario === "claude";
  console.log(JSON.stringify({ loggedIn, authMethod: "oauth" }));
  process.exit(loggedIn ? 0 : 1);
}
if (args.join(" ") !== "/login") {
  console.error("Unsupported scenario Claude command");
  process.exit(2);
}
console.log("https://claude.scenario.invalid/oauth/authorize?state=scenario");
console.log("Paste code here");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (code) => {
  if (code.trim() !== ${JSON.stringify(CLAUDE_SCENARIO_CODE)}) {
    console.log("Invalid authorization code");
    process.exit(1);
  }
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(credential, JSON.stringify({ scenario: "claude" }), { mode: 0o600 });
  console.log("Login successful");
  lines.close();
  process.exit(0);
});
`,
    { mode: 0o700 },
  );
  return Layer.effectContext(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const pty = yield* PtyAdapter;
      // The container's /var/www is this scenario's workspace, never a host directory.
      const local = (cwd: string) => (cwd === "/var/www" ? input.cwd : cwd);
      const nativeSpawner = ChildProcessSpawner.make((command) =>
        spawner.spawn(
          ChildProcess.isStandardCommand(command) && command.command === "claude"
            ? ChildProcess.make(process.execPath, [executable, ...command.args], {
                ...command.options,
                env: {
                  ...command.options.env,
                  CLAUDE_CONFIG_DIR:
                    command.options.env?.CLAUDE_CONFIG_DIR ??
                    NodePath.join(input.homeDir, ".claude"),
                },
                extendEnv: command.options.env === undefined ? true : command.options.extendEnv,
              })
            : command,
        ),
      );
      return Context.make(FileSystem.FileSystem, {
        ...fs,
        stat: (path) => fs.stat(local(path)),
      }).pipe(
        Context.add(ChildProcessSpawner.ChildProcessSpawner, nativeSpawner),
        Context.add(PtyAdapter, {
          spawn: (request) =>
            pty.spawn({
              ...request,
              shell: "/bin/sh",
              args: [],
              cwd: local(request.cwd),
              env: {
                ...request.env,
                HOME: input.homeDir,
                PATH: `${directory}:${request.env.PATH ?? ""}`,
              },
            }),
        }),
      );
    }),
  );
}
