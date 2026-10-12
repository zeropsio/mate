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
}

export const macHostPaths = (baseDir: string): MacHostPaths => {
  const dir = `${baseDir}/mac`;
  return {
    dir,
    key: `${dir}/id_ed25519`,
    publicKey: `${dir}/id_ed25519.pub`,
    record: `${dir}/host.json`,
    knownHosts: `${dir}/known_hosts`,
  };
};

export const decodeMacHostRecord = (json: string): MacHostRecord | undefined =>
  Option.getOrUndefined(decodeRecordJson(json));

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

export type MacCommand =
  | { readonly _tag: "help" }
  | { readonly _tag: "pair" }
  | { readonly _tag: "host"; readonly remove: boolean }
  | { readonly _tag: "register" }
  | { readonly _tag: "status"; readonly json: boolean }
  | { readonly _tag: "sync" }
  | { readonly _tag: "run"; readonly command: ReadonlyArray<string> }
  | { readonly _tag: "device"; readonly args: ReadonlyArray<string> }
  | { readonly _tag: "screenshot"; readonly out: string | undefined }
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
    case "device":
      return rest.length > 0
        ? { _tag: "device", args: rest }
        : {
            _tag: "usage",
            message: "mac device needs agent-device arguments, for example: mac device snapshot -i",
          };
    case "screenshot":
      return rest.length <= 1
        ? { _tag: "screenshot", out: rest[0] }
        : { _tag: "usage", message: "mac screenshot takes at most one output path." };
    default:
      return { _tag: "usage", message: `Unknown command: mac ${word}. Run mac help.` };
  }
};

export const MAC_HELP = `mac - work on the Mac paired with this Mate, over the project VPN.

  mac status              Whether a Mac is paired and reachable.
  mac pair                Print the two commands to run on the Mac to pair it.
  mac sync                Copy the current directory to the Mac (honours .gitignore).
  mac run <command>       Run a shell command in that copy on the Mac.
  mac device <args>       Run agent-device on the Mac (macOS apps by default):
                            mac device open <bundle id>
                            mac device snapshot -i
                            mac device press @e3 --settle
  mac screenshot [path]   Save a screenshot of the open app here and print its path.
  mac unpair              Forget the Mac (prints how to remove its setup too).`;

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

const agentDevice = (record: MacHostRecord) => shellQuote(`${record.root}/bin/agent-device`);

/** agent-device on the Mac, aimed at macOS apps unless the arguments pick a platform. */
export const macDeviceCommand = (record: MacHostRecord, args: ReadonlyArray<string>): string => {
  const platform = args.some((arg) => arg === "--platform" || arg.startsWith("--platform="))
    ? []
    : ["--platform", "macos"];
  return [agentDevice(record), ...[...args, ...platform].map(shellQuote)].join(" ");
};

/** Takes a screenshot on the Mac and streams the PNG to stdout. */
export const macScreenshotCommand = (record: MacHostRecord): string => {
  const file = `"$TMPDIR/mate-screenshot-$$.png"`;
  return `${agentDevice(record)} screenshot ${file} --platform macos >/dev/null && cat ${file} && rm -f ${file}`;
};

/** What the Mac reports about itself, one `key=value` per line for {@link macStatusReport}. */
export const macStatusCommand = (record: MacHostRecord): string =>
  [
    `printf 'macos=%s\\n' "$(sw_vers -productVersion)"`,
    `printf 'agent-device=%s\\n' "$(${agentDevice(record)} --version 2>/dev/null)"`,
    `printf 'access=%s\\n' "$(${shellQuote(`${record.root}/bin/check-access`)} 2>/dev/null)"`,
  ].join("; ");

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
    pairCommands: [`zcli vpn up ${input.projectId}`, `ssh ${input.host} mac host | sh`],
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
