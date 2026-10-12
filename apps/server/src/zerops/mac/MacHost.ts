/**
 * MacHost - a Mac the user pairs with this Mate for macOS and iOS app work.
 *
 * The Mate reaches the Mac over the project VPN. Pairing (see `macHostScript.ts`)
 * leaves two LaunchAgents on the Mac: an sshd of the pairing user's own, bound
 * to the Mac's VPN address and admitting only this Mate's key, and an
 * agent-device daemon in the logged-in session, where macOS lets it see and
 * operate apps. Every `mac` command is an ssh or rsync invocation built here.
 *
 * The Mate holds a full shell on the Mac as the pairing user; building an app
 * runs arbitrary code anyway, so the Mac is exactly as trusted as the container.
 *
 * @module MacHost
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { MacViewMessage } from "./macViewWire.ts";

/** agent-device on the Mac; the native macOS backend needs no Xcode. */
export const AGENT_DEVICE_VERSION = "0.21.24";

/** What the Mac reports when it pairs, plus the address the Mate reaches it on. */
export const MacHostRecord = Schema.Struct({
  address: Schema.String,
  port: Schema.Int,
  user: Schema.String,
  hostKey: Schema.String,
  /** The Mac-side home of this pairing: the sshd, agent-device and its wrapper. */
  root: Schema.String,
  /** Where `mac sync` copies working directories, one folder per directory name. */
  workspace: Schema.String,
  name: Schema.String,
  macos: Schema.String,
  /** The node the agent-device daemon runs on: what the user allows in System Settings. */
  node: Schema.optional(Schema.String),
});
export type MacHostRecord = typeof MacHostRecord.Type;

const decodeRecordJson = Schema.decodeUnknownOption(Schema.fromJsonString(MacHostRecord));

export interface MacHostPaths {
  readonly dir: string;
  readonly key: string;
  readonly publicKey: string;
  readonly record: string;
  readonly knownHosts: string;
  /** The app the live view shows: the last one an agent opened with `mac open` or `mac device open`. */
  readonly view: string;
}

export const macHostPaths = (baseDir: string): MacHostPaths => {
  const dir = `${baseDir}/mac`;
  return {
    dir,
    key: `${dir}/id_ed25519`,
    publicKey: `${dir}/id_ed25519.pub`,
    record: `${dir}/host.json`,
    knownHosts: `${dir}/known_hosts`,
    view: `${dir}/view.json`,
  };
};

export const decodeMacHostRecord = (json: string): MacHostRecord | undefined =>
  Option.getOrUndefined(decodeRecordJson(json));

/** What the live view shows: an app (bundle id or name), and when an agent opened it. */
export const MacViewRecord = Schema.Struct({ app: Schema.String, at: Schema.Number });
export type MacViewRecord = typeof MacViewRecord.Type;

const decodeViewJson = Schema.decodeUnknownOption(Schema.fromJsonString(MacViewRecord));

export const decodeMacViewRecord = (json: string): MacViewRecord | undefined =>
  Option.getOrUndefined(decodeViewJson(json));

/** agent-device flags of `open` that take the next word as their value. */
const OPEN_VALUE_FLAGS = new Set(["--platform", "--surface", "--device", "--session", "--udid"]);

/** The app `mac device <args>` opens, which the live view then follows; none for any other command. */
export const macViewTarget = (args: ReadonlyArray<string>): string | undefined => {
  if (args[0] !== "open") return undefined;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    if (OPEN_VALUE_FLAGS.has(arg)) {
      index++;
      continue;
    }
    if (!arg.startsWith("-")) return arg;
  }
  return undefined;
};

/** A window on the Mac's screen, in points, as macOS reports it. */
export interface MacWindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A point on a captured window image (pixels; a Retina capture is twice the
 * window's size) to the screen point agent-device presses.
 */
export const macScreenPoint = (
  bounds: MacWindowBounds,
  image: { readonly width: number; readonly height: number },
  pixel: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } => ({
  x: Math.round(bounds.x + (pixel.x * bounds.width) / (image.width || bounds.width || 1)),
  y: Math.round(bounds.y + (pixel.y * bounds.height) / (image.height || bounds.height || 1)),
});

/**
 * The Mac's registration, accepted only from inside the project VPN range: the
 * address is where the Mate will connect, so one outside it is refused.
 */
export const acceptMacRegistration = (
  json: string,
  vpnRange: string | undefined,
): { readonly record: MacHostRecord } | { readonly refused: string } => {
  const record = decodeMacHostRecord(json);
  if (record === undefined) {
    return { refused: "the Mac's registration was incomplete; run the pairing again." };
  }
  if (vpnRange === undefined || !isIpv4InRange(record.address, vpnRange)) {
    return {
      refused: `${record.address} is not on this project's VPN${vpnRange ? ` (${vpnRange})` : ""}.`,
    };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(record.user)) {
    return { refused: `the Mac user name ${JSON.stringify(record.user)} is not usable.` };
  }
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+$/.test(record.hostKey)) {
    return { refused: "the Mac's ssh host key is not an ed25519 key." };
  }
  return { record };
};

const ipv4ToInt = (address: string): number | undefined => {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
};

export const isIpv4InRange = (address: string, cidr: string): boolean => {
  const [base, bitsText] = cidr.split("/");
  const addressInt = ipv4ToInt(address);
  const baseInt = base === undefined ? undefined : ipv4ToInt(base);
  const bits = Number(bitsText);
  if (addressInt === undefined || baseInt === undefined) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(addressInt / size) === Math.floor(baseInt / size);
};

/**
 * One port per project, so a Mac on several project VPNs runs one sshd per
 * Mate without them colliding.
 */
export const macSshPort = (projectId: string): number => {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 22_000 + (hash % 1_000);
};

/** The user's go-ahead to drive a Mac they are working on; see {@link macInUseGuard}. */
export const WHILE_IN_USE = "--while-in-use";

export type MacCommand =
  | { readonly _tag: "help" }
  | { readonly _tag: "pair" }
  | { readonly _tag: "host"; readonly remove: boolean }
  | { readonly _tag: "register" }
  | { readonly _tag: "status"; readonly json: boolean }
  | { readonly _tag: "sync" }
  | { readonly _tag: "run"; readonly command: ReadonlyArray<string> }
  | { readonly _tag: "open"; readonly app: string }
  | { readonly _tag: "device"; readonly args: ReadonlyArray<string>; readonly whileInUse: boolean }
  | {
      readonly _tag: "screenshot";
      readonly out: string | undefined;
      readonly whileInUse: boolean;
      /** The whole screen through agent-device, rather than the app the Mac tab shows. */
      readonly screen: boolean;
    }
  | { readonly _tag: "unpair" }
  | { readonly _tag: "usage"; readonly message: string };

export const parseMacCommand = (args: ReadonlyArray<string>): MacCommand => {
  const [word, ...rest] = args;
  switch (word) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return { _tag: "help" };
    case "status":
      return rest.length === 0 || (rest.length === 1 && rest[0] === "--json")
        ? { _tag: "status", json: rest[0] === "--json" }
        : { _tag: "usage", message: "mac status takes only --json." };
    case "pair":
    case "register":
    case "sync":
    case "unpair":
      return rest.length === 0
        ? { _tag: word }
        : { _tag: "usage", message: `mac ${word} takes no arguments.` };
    case "host":
      return rest.length === 0 || (rest.length === 1 && rest[0] === "--remove")
        ? { _tag: "host", remove: rest[0] === "--remove" }
        : { _tag: "usage", message: "mac host takes only --remove." };
    case "run":
      return rest.length > 0
        ? { _tag: "run", command: rest }
        : { _tag: "usage", message: "mac run needs a command, for example: mac run swift build" };
    case "open":
      return rest.length === 1
        ? { _tag: "open", app: rest[0]! }
        : {
            _tag: "usage",
            message:
              "mac open takes one app: a .app in the copy (mac open build/Counter.app), a bundle id or a name.",
          };
    case "device": {
      const whileInUse = rest[0] === WHILE_IN_USE;
      const deviceArgs = whileInUse ? rest.slice(1) : rest;
      return deviceArgs.length > 0
        ? { _tag: "device", args: deviceArgs, whileInUse }
        : {
            _tag: "usage",
            message: "mac device needs agent-device arguments, for example: mac device snapshot -i",
          };
    }
    case "screenshot": {
      const whileInUse = rest.includes(WHILE_IN_USE);
      const screen = rest.includes("--screen");
      const paths = rest.filter((arg) => arg !== WHILE_IN_USE && arg !== "--screen");
      return paths.length <= 1
        ? { _tag: "screenshot", out: paths[0], whileInUse, screen }
        : { _tag: "usage", message: "mac screenshot takes at most one output path." };
    }
    default:
      return { _tag: "usage", message: `Unknown command: mac ${word}. Run mac help.` };
  }
};

export const MAC_HELP = `mac - work on the Mac paired with this Mate, over the project VPN.

  mac status              Whether a Mac is paired and reachable.
  mac pair                Print the two commands to run on the Mac to pair it.
  mac sync                Copy the current directory to the Mac (honours .gitignore).
  mac run <command>       Run a shell command in that copy on the Mac (build there).
  mac open <app>          Open an app in the background, behind the user's windows, and show
                          it live in their Mac tab: a .app in the copy (build/Counter.app),
                          a bundle id or a name. A build of that .app still running quits first.
  mac device <args>       Run agent-device on the Mac (macOS apps by default):
                            mac device open <bundle id>
                            mac device snapshot -i
                            mac device press @e3 --settle
  mac screenshot [path]   Save a picture of the app the Mac tab shows here and print its path;
                          silent, so it works while someone uses the Mac. --screen takes
                          the whole screen instead, or when no app is open.

  mac open never takes over the screen, so it runs while someone is using the Mac.
  mac device and mac screenshot --screen raise the app and click on screen, so they wait while
  someone is using the Mac (exit 75); --while-in-use goes ahead with the user's say-so.
  mac unpair              Forget the Mac (prints how to remove its setup too).`;

/** A screenshot from the Mac tab's live view: its first frame, or why there is none. */
export type MacViewShot =
  | { readonly _tag: "frame"; readonly bytes: Uint8Array; readonly mimeType: string }
  | { readonly _tag: "none"; readonly status: "no-app" | "no-window" | "no-capture" };

/**
 * Reads the view helper's messages for a screenshot: the first frame is it; a
 * state means the view has no picture, so the screen's own screenshot is the
 * way; nothing yet means keep reading.
 */
export const macViewShot = (messages: ReadonlyArray<MacViewMessage>): MacViewShot | undefined => {
  for (const message of messages) {
    if (message.type === "frame") {
      return { _tag: "frame", bytes: message.bytes, mimeType: message.mimeType };
    }
    if (message.type === "state") return { _tag: "none", status: message.status };
  }
  return undefined;
};

/** Where a picture lands: the path asked for, its extension the picture's own. */
export const macShotPath = (out: string, mimeType: string): string =>
  `${out.replace(/\.(png|jpe?g)$/i, "")}${mimeType === "image/jpeg" ? ".jpg" : ".png"}`;

/** POSIX single-quoting for one word of a remote shell command. */
export const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const sshOptions = (record: MacHostRecord, paths: MacHostPaths): ReadonlyArray<string> => [
  "-i",
  paths.key,
  "-p",
  String(record.port),
  "-o",
  "BatchMode=yes",
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  `UserKnownHostsFile=${paths.knownHosts}`,
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "LogLevel=ERROR",
  // The container multiplexes every host for minutes (~/.ssh/config); a lingering
  // connection would answer for a Mac whose ssh server is gone.
  "-o",
  "ControlMaster=no",
  "-o",
  "ControlPath=none",
];

export const knownHostsLine = (record: MacHostRecord): string =>
  `[${record.address}]:${record.port} ${record.hostKey}\n`;

/** `ssh` arguments that run one shell command on the Mac. */
export const macSshArgs = (
  record: MacHostRecord,
  paths: MacHostPaths,
  remoteCommand: string,
): ReadonlyArray<string> => [
  ...sshOptions(record, paths),
  `${record.user}@${record.address}`,
  remoteCommand,
];

const directoryName = (cwd: string): string =>
  cwd.replace(/\/+$/, "").split("/").pop() || "workspace";

/** The Mac-side copy of a working directory. */
export const macWorkspaceDir = (record: MacHostRecord, cwd: string): string =>
  `${record.workspace}/${directoryName(cwd)}`;

/** Creates the copy's folder; rsync makes only the last level itself. */
export const macSyncPrepareCommand = (record: MacHostRecord, cwd: string): string =>
  `mkdir -p ${shellQuote(macWorkspaceDir(record, cwd))}`;

/**
 * `rsync` arguments that mirror `cwd` onto the Mac. Ignored files (build output,
 * dependencies) are neither sent nor deleted there, so the Mac keeps its builds.
 */
export const macSyncArgs = (
  record: MacHostRecord,
  paths: MacHostPaths,
  cwd: string,
): ReadonlyArray<string> => [
  "-az",
  "--delete",
  "--filter=:- .gitignore",
  "--exclude=.git/",
  "-e",
  ["ssh", ...sshOptions(record, paths)].map(shellQuote).join(" "),
  `${cwd.replace(/\/+$/, "")}/`,
  `${record.user}@${record.address}:${macWorkspaceDir(record, cwd)}/`,
];

/** Runs the command as ssh would: the words joined into one shell line, in the copy. */
export const macRunCommand = (
  record: MacHostRecord,
  cwd: string,
  command: ReadonlyArray<string>,
): string => {
  const dir = shellQuote(macWorkspaceDir(record, cwd));
  return `cd ${dir} 2>/dev/null || { echo "Nothing synced to the Mac yet; run mac sync first." >&2; exit 66; }; ${command.join(" ")}`;
};

/** A bundle id such as com.example.Counter: dotted words without spaces. */
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Opens an app with `open -g`: it launches behind the user's windows and takes
 * no focus, so it runs while they work. A .app path is the copy's build; a
 * build of it still running is quit first, or `open` would only bring the old
 * one back. An app that activates itself on launch anyway gets the front taken
 * back for the app the user was in. Prints what the live view should follow:
 * the app's real path, or the bundle id or name as given.
 */
export const macOpenCommand = (record: MacHostRecord, cwd: string, app: string): string => {
  const quoted = shellQuote(app);
  const isPath = app.includes("/") || app.endsWith(".app");
  const running = `ps -A -o pid= -o command= | P="$app/Contents/MacOS/" awk 'index($0, ENVIRON["P"]) { print $1 }'`;
  const [open, key] = isPath
    ? [`open -g "$app"`, "bundlepath"]
    : BUNDLE_ID.test(app)
      ? [`open -g -b "$app"`, "bundleid"]
      : [`open -g -a "$app"`, "name"];
  return [
    // One field of the front app, as lsappinfo reports it; nothing where it cannot tell.
    `front() { lsappinfo info -only "$1" "$(lsappinfo front 2>/dev/null)" 2>/dev/null | sed -n 's/^"[^"]*"="\\(.*\\)"$/\\1/p'; }`,
    `app=${quoted}`,
    ...(isPath
      ? [
          `cd ${shellQuote(macWorkspaceDir(record, cwd))} 2>/dev/null || cd "$HOME"`,
          `case "$app" in "~/"*) app="$HOME/\${app#"~/"}";; esac`,
          `[ -d "$app" ] || { printf '%s\\n' "No app at $app in the Mac's copy. Build it there first (mac run), or open an installed app by its bundle id or name." >&2; exit 66; }`,
          `app=$(cd "$app" && pwd -P)`,
          `pids=$(${running})`,
          `if [ -n "$pids" ]; then kill $pids 2>/dev/null; i=0; while [ $i -lt 30 ] && [ -n "$(${running})" ]; do sleep 0.1; i=$((i + 1)); done; fi`,
        ]
      : []),
    `was=$(front bundleid)`,
    `${open} || exit $?`,
    `case "$was" in ''|com.apple.loginwindow) ;; *) i=0; while [ $i -lt 15 ]; do if [ "$(front ${key})" = "$app" ]; then open -b "$was"; break; fi; sleep 0.2; i=$((i + 1)); done;; esac`,
    `printf '%s\\n' "$app"`,
  ].join("; ");
};

const agentDevice = (record: MacHostRecord) => shellQuote(`${record.root}/bin/agent-device`);

/** Seconds since the last keyboard or mouse input after which the Mac counts as free. */
export const MAC_IDLE_SECONDS = 60;

/** When the Mate last drove the Mac, in epoch seconds: its own clicks are input too. */
const lastDriveFile = (record: MacHostRecord) => shellQuote(`${record.root}/last-drive`);

/**
 * Driving an app raises it and clicks where it points, so on a Mac its user is
 * working on it would take over their screen. Unless they said go ahead, the
 * command waits for the Mac to be idle and otherwise stops with EX_TEMPFAIL.
 * Input no later than the Mate's own last drive was the Mate's, so it never
 * makes the Mac look busy to the Mate's next click.
 */
const macInUseGuard = (record: MacHostRecord): string =>
  `idle=$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ { print int($NF / 1000000000); exit }'); ` +
  `own=$(cat ${lastDriveFile(record)} 2>/dev/null); case "$own" in ''|*[!0-9]*) own=0;; esac; ` +
  `if [ "\${idle:-${MAC_IDLE_SECONDS}}" -lt ${MAC_IDLE_SECONDS} ] && [ $(( $(date +%s) - own )) -gt $(( \${idle:-${MAC_IDLE_SECONDS}} + 2 )) ]; then ` +
  `echo "The user is working on this Mac right now (last input \${idle}s ago), so this did not take over their screen. Ask them, or wait until they step away; with their go-ahead, add ${WHILE_IN_USE}." >&2; exit 75; fi; `;

/** agent-device commands that move nothing on screen, so they run while the user works. */
const MOVES_NOTHING = new Set([
  "apps",
  "devices",
  "doctor",
  "help",
  "--help",
  "--version",
  "close",
  "logs",
]);

/** agent-device on the Mac, aimed at macOS apps unless the arguments pick a platform. */
export const macDeviceCommand = (
  record: MacHostRecord,
  args: ReadonlyArray<string>,
  options: { readonly whileInUse?: boolean } = {},
): string => {
  const platform = args.some((arg) => arg === "--platform" || arg.startsWith("--platform="))
    ? []
    : ["--platform", "macos"];
  const command = [agentDevice(record), ...[...args, ...platform].map(shellQuote)].join(" ");
  if (MOVES_NOTHING.has(args[0] ?? "")) return command;
  const guard = options.whileInUse ? "" : macInUseGuard(record);
  return `${guard}${command}; rc=$?; date +%s > ${lastDriveFile(record)} 2>/dev/null; exit $rc`;
};

/** Takes a screenshot on the Mac and streams the PNG to stdout; it raises the app, so it is guarded. */
export const macScreenshotCommand = (
  record: MacHostRecord,
  options: { readonly whileInUse?: boolean } = {},
): string => {
  const file = `"$TMPDIR/mate-screenshot-$$.png"`;
  return `${options.whileInUse ? "" : macInUseGuard(record)}${agentDevice(record)} screenshot ${file} --platform macos >/dev/null && cat ${file} && rm -f ${file}`;
};

/** The Mac-side live view helper's socket; see `macViewScript.ts`. */
export const macViewSocket = (record: MacHostRecord): string => `${record.root}/view.sock`;

/**
 * Streams the app's window from the Mac's view helper for as long as the ssh
 * connection lasts: one connection, frames at `fps`. curl exits 7 when no
 * helper answers (a pairing older than the live view).
 */
export const macViewStreamCommand = (record: MacHostRecord, app: string, fps: number): string =>
  `exec curl -sN --unix-socket ${shellQuote(macViewSocket(record))} ${shellQuote(
    `http://mate/stream?app=${encodeURIComponent(app)}&fps=${fps}`,
  )}`;

/** curl's own exit code for a socket nobody listens on. */
export const MAC_VIEW_NO_HELPER_EXIT = 7;

/** What the Mac reports about itself, one `key=value` per line for {@link macStatusReport}. */
export const macStatusCommand = (record: MacHostRecord): string =>
  [
    `printf 'macos=%s\\n' "$(sw_vers -productVersion)"`,
    `printf 'agent-device=%s\\n' "$(${agentDevice(record)} --version 2>/dev/null)"`,
    `printf 'access=%s\\n' "$(${shellQuote(`${record.root}/bin/check-access`)} 2>/dev/null)"`,
  ].join("; ");

/** The commands a person runs on their Mac to pair it with this Mate: the VPN first, then the pairing. */
export const macPairCommands = (projectId: string, host: string): ReadonlyArray<string> => [
  `zcli vpn up ${projectId}`,
  `ssh ${host} mac host | sh`,
];

export type MacStage = "not-paired" | "unreachable" | "needs-permissions" | "ready";

/**
 * Where pairing stands and what the user does next. `mac status --json` prints
 * it, and zcp's guided pairing reads it: the shape is the seam between them.
 */
export interface MacStatusReport {
  readonly stage: MacStage;
  readonly pairCommands: ReadonlyArray<string>;
  readonly removeCommand: string;
  readonly mac: {
    readonly name: string;
    readonly user: string;
    readonly address: string;
    readonly port: number;
    readonly macos: string | null;
    readonly agentDevice: string | null;
    readonly node: string | null;
  } | null;
  readonly missing: ReadonlyArray<"Accessibility" | "Screen Recording">;
}

const PERMISSIONS = ["Accessibility", "Screen Recording"] as const;

export const macStatusReport = (input: {
  readonly projectId: string;
  readonly host: string;
  readonly record: MacHostRecord | undefined;
  /** The ssh run of {@link macStatusCommand}; 255 is ssh's own failure to connect. */
  readonly probe: { readonly code: number; readonly stdout: string } | undefined;
}): MacStatusReport => {
  const commands = {
    pairCommands: macPairCommands(input.projectId, input.host),
    removeCommand: `ssh ${input.host} mac host --remove | sh`,
  };
  const { record, probe } = input;
  if (record === undefined) return { stage: "not-paired", mac: null, missing: [], ...commands };
  const reported = new Map(
    (probe?.code === 0 ? probe.stdout : "").split("\n").flatMap((line) => {
      const at = line.indexOf("=");
      return at > 0 ? [[line.slice(0, at), line.slice(at + 1).trim()] as const] : [];
    }),
  );
  const mac = {
    name: record.name,
    user: record.user,
    address: record.address,
    port: record.port,
    macos: reported.get("macos") || null,
    agentDevice: reported.get("agent-device") || null,
    node: record.node ?? null,
  };
  if (probe === undefined || probe.code !== 0) {
    return { stage: "unreachable", mac, missing: [], ...commands };
  }
  const access = reported.get("access") ?? "";
  const missing = PERMISSIONS.filter((permission) => !access.includes(`${permission} allowed`));
  return {
    stage: missing.length === 0 ? "ready" : "needs-permissions",
    mac,
    missing,
    ...commands,
  };
};

/** `mac status` for a person or an agent reading text; the exit code says whether it is ready. */
export const renderMacStatus = (
  report: MacStatusReport,
): { readonly text: string; readonly exitCode: number } => {
  const [vpnUp, pair] = report.pairCommands;
  const { mac } = report;
  if (mac === null) {
    return {
      exitCode: 69,
      text: [
        "No Mac is paired with this Mate. To pair one, run these in Terminal on the Mac:",
        "",
        ...report.pairCommands.map((command) => `  ${command}`),
        "",
        "The Mac needs zcli (logged in) and Node.js. The second command installs agent-device and",
        "starts, as the user, a private ssh server reachable only over this project's VPN.",
      ].join("\n"),
    };
  }
  const who = `${mac.name} (${mac.user}@${mac.address}:${mac.port})`;
  switch (report.stage) {
    case "unreachable":
      return {
        exitCode: 1,
        text: `Paired with ${who}, but it does not answer. On the Mac: make sure it is awake and logged in, and connect the VPN (${vpnUp}). If it still does not answer, pair again (${pair}).`,
      };
    case "needs-permissions":
      return {
        exitCode: 1,
        text: `Paired with ${who}, but macOS has not allowed node ${report.missing.join(" and ")} yet. On the Mac, in System Settings > Privacy & Security, turn on node under ${report.missing.join(" and under ")}${mac.node ? ` (add ${mac.node} with + if it is not listed)` : ""}, or run ${pair} again to be walked through it.`,
      };
    default:
      return {
        exitCode: 0,
        text: `Paired with ${who} · macOS ${mac.macos ?? "?"} · agent-device ${mac.agentDevice ?? "?"} · Accessibility and Screen Recording allowed.`,
      };
  }
};
