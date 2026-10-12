/**
 * `mate mac` - work on the Mac paired with this Mate (see `zerops/mac/MacHost.ts`).
 *
 * Agents call it through the `mac` shim on their PATH, which passes every word
 * after `--`, so agent-device flags such as `--settle` reach the Mac untouched.
 * The commands are thin: each is one ssh or rsync run with the terminal
 * attached, and the remote exit code becomes this command's exit code.
 */
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command } from "effect/cli";

import {
  acceptMacRegistration,
  AGENT_DEVICE_VERSION,
  knownHostsLine,
  MAC_HELP,
  macDeviceCommand,
  macHostPaths,
  type MacHostPaths,
  type MacHostRecord,
  decodeMacHostRecord,
  macRunCommand,
  macScreenshotCommand,
  macSshArgs,
  macSshPort,
  macStatusCommand,
  macStatusReport,
  renderMacStatus,
  macSyncArgs,
  macSyncPrepareCommand,
  macOpenCommand,
  macShotPath,
  macViewShot,
  type MacViewShot,
  macViewStreamCommand,
  decodeMacViewRecord,
  macViewTarget,
  parseMacCommand,
} from "../zerops/mac/MacHost.ts";
import { makeMacViewParser } from "../zerops/mac/macViewWire.ts";
import {
  renderMacHostFailure,
  renderMacHostScript,
  renderMacRemoveScript,
} from "../zerops/mac/macHostScript.ts";
import { resolveBaseDir } from "../os-jank.ts";

class MacFailure {
  readonly message: string;
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    this.message = message;
    this.exitCode = exitCode;
  }
}

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const projectId = (): string => {
  const id = env("T3CODE_ZEROPS_PROJECT_ID") ?? env("projectId");
  if (id === undefined) throw new MacFailure("mac works only inside a Zerops Mate container.");
  return id;
};

const readRecord = (paths: MacHostPaths): MacHostRecord | undefined => {
  try {
    return decodeMacHostRecord(NodeFS.readFileSync(paths.record, "utf8"));
  } catch {
    return undefined;
  }
};

const pairedRecord = (paths: MacHostPaths): MacHostRecord => {
  const record = readRecord(paths);
  if (record === undefined) {
    throw new MacFailure("No Mac is paired with this Mate. Run mac pair to pair one.", 69);
  }
  return record;
};

const ensureMateKey = (paths: MacHostPaths, project: string): string => {
  if (!NodeFS.existsSync(paths.key)) {
    NodeFS.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    const keygen = NodeChildProcess.spawnSync(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", `zerops-mate-${project}`, "-f", paths.key],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    if (keygen.status !== 0) throw new MacFailure("Could not create this Mate's ssh key.");
  }
  return NodeFS.readFileSync(paths.publicKey, "utf8").trim();
};

/** The live view (the Mac tab) follows the app an agent opened last. */
const writeView = (paths: MacHostPaths, app: string) =>
  NodeFS.writeFileSync(paths.view, `${JSON.stringify({ app, at: Date.now() })}\n`, {
    mode: 0o600,
  });

const readView = (paths: MacHostPaths) => {
  try {
    return decodeMacViewRecord(NodeFS.readFileSync(paths.view, "utf8"));
  } catch {
    return undefined;
  }
};

/** How long a screenshot waits for the live view's first frame (a capture under launchd takes seconds). */
const VIEW_SHOT_TIMEOUT_MS = 20_000;

/** The live view's first frame of `app`, over one ssh connection; none when the view has no picture. */
const viewShot = (
  record: MacHostRecord,
  paths: MacHostPaths,
  app: string,
): Promise<MacViewShot | undefined> =>
  new Promise((resolve) => {
    const child = NodeChildProcess.spawn(
      "ssh",
      macSshArgs(record, paths, macViewStreamCommand(record, app, 2)),
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const parser = makeMacViewParser();
    let settled = false;
    const settle = (shot: MacViewShot | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(shot);
    };
    const timer = setTimeout(() => settle(undefined), VIEW_SHOT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      const shot = macViewShot(parser.push(chunk));
      if (shot !== undefined || parser.broken) settle(shot);
    });
    child.on("error", () => settle(undefined));
    child.on("close", () => settle(undefined));
  });

/** Runs with the terminal attached; returns the exit code. */
const run = (
  command: string,
  args: ReadonlyArray<string>,
  stdout: "inherit" | "ignore" | number = "inherit",
): number => {
  const child = NodeChildProcess.spawnSync(command, args, {
    stdio: ["inherit", stdout, "inherit"],
  });
  if (child.error) throw new MacFailure(`Could not run ${command}: ${child.error.message}`);
  return child.status ?? 1;
};

/** Runs the status probe on the Mac with its output captured; 255 when ssh cannot connect. */
const probeMac = (record: MacHostRecord, paths: MacHostPaths) => {
  const child = NodeChildProcess.spawnSync(
    "ssh",
    macSshArgs(record, paths, macStatusCommand(record)),
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
    },
  );
  return { code: child.error ? 255 : (child.status ?? 255), stdout: child.stdout ?? "" };
};

const statusReport = (paths: MacHostPaths, probe: boolean) => {
  const record = readRecord(paths);
  return macStatusReport({
    projectId: projectId(),
    host: env("hostname") ?? "zcp",
    record,
    probe: record && probe ? probeMac(record, paths) : undefined,
  });
};

const runMac = async (args: ReadonlyArray<string>, baseDir: string): Promise<number> => {
  const paths = macHostPaths(baseDir);
  const command = parseMacCommand(args);
  switch (command._tag) {
    case "help":
      console.log(MAC_HELP);
      return 0;
    case "usage":
      throw new MacFailure(command.message, 64);
    case "pair": {
      ensureMateKey(paths, projectId());
      const paired = readRecord(paths);
      const report = statusReport(paths, false);
      console.log(
        [
          ...(paired ? [`Paired now with ${paired.name}; pairing again replaces it.`, ""] : []),
          renderMacStatus({ ...report, mac: null }).text,
        ].join("\n"),
      );
      return 0;
    }
    case "host": {
      // Piped into sh on the Mac: even a failure must be a script.
      try {
        const project = projectId();
        if (command.remove) {
          process.stdout.write(renderMacRemoveScript(project, env("hostname") ?? "zcp"));
          return 0;
        }
        const mateAddress = env("ZEROPS_VxLanIPv4");
        const vpnRange = env("ZEROPS_VpnIPv4Range");
        if (mateAddress === undefined || vpnRange === undefined) {
          throw new MacFailure("this container does not know its project VPN.");
        }
        process.stdout.write(
          renderMacHostScript({
            projectId: project,
            mateHost: env("hostname") ?? "zcp",
            mateAddress,
            vpnRange,
            port: macSshPort(project),
            mateKey: ensureMateKey(paths, project),
            agentDeviceVersion: AGENT_DEVICE_VERSION,
          }),
        );
        return 0;
      } catch (cause) {
        process.stdout.write(
          renderMacHostFailure(cause instanceof MacFailure ? cause.message : String(cause)),
        );
        return 1;
      }
    }
    case "register": {
      const accepted = acceptMacRegistration(
        NodeFS.readFileSync(0, "utf8"),
        env("ZEROPS_VpnIPv4Range"),
      );
      if ("refused" in accepted) throw new MacFailure(`Pairing refused: ${accepted.refused}`);
      const { record } = accepted;
      NodeFS.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      NodeFS.writeFileSync(paths.knownHosts, knownHostsLine(record), { mode: 0o600 });
      NodeFS.writeFileSync(paths.record, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      if (run("ssh", macSshArgs(record, paths, "true"), "ignore") !== 0) {
        throw new MacFailure(
          `Saved the pairing, but the Mate could not log in to ${record.address}:${record.port}. Check the ssh server log in ${record.root}/logs.`,
        );
      }
      console.log(
        `Zerops Mate: the Mate reaches ${record.name} at ${record.address}:${record.port}.`,
      );
      return 0;
    }
    case "status": {
      const report = statusReport(paths, true);
      if (command.json) {
        console.log(JSON.stringify(report));
        return 0;
      }
      const { text, exitCode } = renderMacStatus(report);
      console.log(text);
      return exitCode;
    }
    case "sync": {
      const record = pairedRecord(paths);
      const cwd = process.cwd();
      const prepared = run("ssh", macSshArgs(record, paths, macSyncPrepareCommand(record, cwd)));
      if (prepared !== 0) return prepared;
      const code = run("rsync", macSyncArgs(record, paths, cwd));
      if (code === 0) {
        console.log(
          `Synced ${cwd} to ${record.name}:${record.workspace}/${NodePath.basename(cwd)}`,
        );
      }
      return code;
    }
    case "run": {
      const record = pairedRecord(paths);
      return run(
        "ssh",
        macSshArgs(record, paths, macRunCommand(record, process.cwd(), command.command)),
      );
    }
    case "open": {
      const record = pairedRecord(paths);
      const child = NodeChildProcess.spawnSync(
        "ssh",
        macSshArgs(record, paths, macOpenCommand(record, process.cwd(), command.app)),
        { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
      );
      if (child.error) throw new MacFailure(`Could not run ssh: ${child.error.message}`);
      const app = child.stdout.trim().split("\n").at(-1);
      if (child.status !== 0 || !app) return child.status ?? 1;
      writeView(paths, app);
      console.log(
        `Opened ${app} on ${record.name}, behind the user's windows; it shows in their Mac tab.`,
      );
      return 0;
    }
    case "device": {
      const record = pairedRecord(paths);
      const code = run(
        "ssh",
        macSshArgs(
          record,
          paths,
          macDeviceCommand(record, command.args, { whileInUse: command.whileInUse }),
        ),
      );
      const app = macViewTarget(command.args);
      if (code === 0 && app !== undefined) writeView(paths, app);
      return code;
    }
    case "screenshot": {
      const record = pairedRecord(paths);
      const asked = NodePath.resolve(
        command.out ??
          NodePath.join(
            NodeOS.tmpdir(),
            "mac-screenshots",
            `screenshot-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.png`,
          ),
      );
      NodeFS.mkdirSync(NodePath.dirname(asked), { recursive: true });
      // The app the Mac tab shows, from its live view: silent, so it never waits on the user.
      const view = command.screen ? undefined : readView(paths);
      const shot = view === undefined ? undefined : await viewShot(record, paths, view.app);
      if (shot?._tag === "frame") {
        const out = macShotPath(asked, shot.mimeType);
        NodeFS.writeFileSync(out, shot.bytes);
        console.log(out);
        return 0;
      }
      const out = macShotPath(asked, "image/png");
      const fd = NodeFS.openSync(out, "w");
      let code: number;
      try {
        code = run(
          "ssh",
          macSshArgs(
            record,
            paths,
            macScreenshotCommand(record, { whileInUse: command.whileInUse }),
          ),
          fd,
        );
      } finally {
        NodeFS.closeSync(fd);
      }
      if (code !== 0) {
        NodeFS.rmSync(out, { force: true });
        return code;
      }
      console.log(out);
      return 0;
    }
    case "unpair": {
      const record = readRecord(paths);
      NodeFS.rmSync(paths.record, { force: true });
      NodeFS.rmSync(paths.knownHosts, { force: true });
      NodeFS.rmSync(paths.view, { force: true });
      console.log(
        [
          record ? `Forgot ${record.name}.` : "No Mac was paired.",
          "To remove this Mate's ssh server and agent-device from the Mac, run there:",
          `  ssh ${env("hostname") ?? "zcp"} mac host --remove | sh`,
        ].join("\n"),
      );
      return 0;
    }
  }
};

/** A failure the user can act on prints as one line; anything else is a bug and throws. */
const runMacReportingFailure = async (
  args: ReadonlyArray<string>,
  baseDir: string,
): Promise<number> => {
  try {
    return await runMac(args, baseDir);
  } catch (cause) {
    if (!(cause instanceof MacFailure)) throw cause;
    console.error(cause.message);
    return cause.exitCode;
  }
};

export const macCommand = Command.make("mac", {
  args: Argument.String("args").pipe(
    Argument.withDescription("A mac command and its arguments; run `mac help`."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Work on the Mac paired with this Mate over the project VPN."),
  Command.withHandler(
    Effect.fn("cli.mac")(function* ({ args }) {
      const home = yield* Config.String("T3CODE_HOME").pipe(Config.option);
      const baseDir = yield* resolveBaseDir(Option.getOrUndefined(home));
      const code = yield* Effect.promise(() => runMacReportingFailure(args, baseDir));
      if (code !== 0) process.exitCode = code;
    }),
  ),
);
