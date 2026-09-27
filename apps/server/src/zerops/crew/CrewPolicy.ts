/**
 * CrewPolicy — the gate: one decision per tool call of a crew thread
 * (CONCEPT §5 *The gate*, PRD §2.3 read-only crewmates). Pure: the caller
 * injects `realpath` and every fact about the turn.
 *
 * Crew sessions run in `dontAsk` with this gate as a total `PreToolUse` hook,
 * so anything not allowed here is denied. It prevents accidents; it is not a
 * security boundary — a shell on the dev service already carries its
 * `GIT_TOKEN`, and D6 is the boundary.
 *
 * - **Every crew thread:** `ToolSearch`, `TodoWrite`, the crew's own tools
 *   (`mcp__crew__*`), `Read` — and `Glob`/`Grep` with an explicit root — by
 *   realpath outside the refused roots, and zcp's read-only tools.
 *   `zerops_workflow` for `status` only; `zerops_verify` and
 *   `zerops_browser` only while this crewmate's work is shown on dev.
 * - **Writers:** `Write`/`Edit`/`MultiEdit`/`NotebookEdit` only inside their
 *   own copy by realpath, never on another crewmate's `migrations:` paths.
 *   `Bash` only as `ssh <host> <payload>` to their own host: a leading
 *   `cd <remoteRoot> &&` (or `;`) is dropped — the form the reloaded project
 *   guidance teaches — a payload that reaches outside the copy is refused,
 *   git runs only read-only subcommands, and the payload is rewritten to run
 *   in the copy with `CREW_PORT`, the crewmate's `env:` and a timeout.
 *   `zerops_dev_server` only in the after-land, claim and release turns, in
 *   exactly their shape.
 * - **Readers and the lead:** no `Write`, `Edit` or `Bash`.
 * - **Refused roots:** the workspace's `.zcp` and `.mate`, `~/.claude`,
 *   `~/.codex`, `~/.t3`, `/proc`, and every `.git` internal.
 * - **Deny-all:** a crew thread without a live stint gets nothing.
 *
 * `zerops_deploy` is refused: previews by `sha=` are phase D.
 *
 * @module CrewPolicy
 */
import type { CrewMemberKind } from "@t3tools/contracts";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import type { CrewLane } from "./CrewDefinition.ts";

/** The SPI's `ToolDecision` shape (`spi/threadToolPolicy.ts`). */
export type GateDecision =
  | { readonly kind: "allow"; readonly updatedInput?: Record<string, unknown> }
  | { readonly kind: "deny"; readonly reason: string };

export interface GateToolCall {
  readonly toolName: string;
  readonly input: unknown;
}

/** Which shaped turn this is; `work` is every ordinary turn. */
export type GateTurn = "work" | "after-land" | "claim-start" | "claim-release";

export interface CrewGateMember {
  readonly handle: string;
  readonly kind: CrewMemberKind;
  /** A writer's copy; readers and the lead have none. */
  readonly lane?: CrewLane;
  readonly crewPort?: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface LiveGateContext {
  readonly kind: "live";
  readonly member: CrewGateMember;
  /** Other crewmates' `migrations:` globs on this member's host, repo-relative. */
  readonly foreignMigrations: ReadonlyArray<string>;
  readonly refusedRoots: ReadonlyArray<string>;
  /** The canonical path of an absolute, normalized path (symlinks resolved). */
  readonly realpath: (path: string) => string;
  /** The zcp container's cwd, which relative paths resolve against. */
  readonly workspaceRoot: string;
  readonly turn: GateTurn;
  /** This crewmate holds the Show-on-dev claim on its host. */
  readonly holdsClaim: boolean;
  /** The dev server a shaped turn restarts: its port and full command. */
  readonly devServer?: { readonly port: number; readonly command: string };
  readonly payloadTimeoutSeconds: number;
}

export type GateContext = LiveGateContext | { readonly kind: "deny-all" };

/** A POSIX path made absolute against `base`, with `.`, `..` and repeated slashes folded. */
const absolutePath = (base: string, path: string): string => {
  const segments: Array<string> = [];
  for (const segment of (path.startsWith("/") ? path : `${base}/${path}`).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
};

export const crewRefusedRoots = (input: {
  readonly workspaceRoot: string;
  readonly home: string;
}): ReadonlyArray<string> => [
  absolutePath(input.workspaceRoot, ".zcp"),
  absolutePath(input.workspaceRoot, ".mate"),
  absolutePath(input.home, ".claude"),
  absolutePath(input.home, ".codex"),
  absolutePath(input.home, ".t3"),
  "/proc",
];

const ALWAYS_ALLOWED = new Set(["ToolSearch", "TodoWrite"]);
const ZEROPS_TOOL_PREFIX = "mcp__zerops__";
const CREW_TOOL_PREFIX = "mcp__crew__";
/** zcp tools annotated `ReadOnlyHint` (zcp `internal/tools/*.go`), `zerops_verify` aside. */
const ZEROPS_READ_ONLY = new Set([
  "zerops_discover",
  "zerops_events",
  "zerops_export",
  "zerops_knowledge",
  "zerops_logs",
  "zerops_preprocess",
]);

const allow: GateDecision = { kind: "allow" };
const deny = (reason: string): GateDecision => ({ kind: "deny", reason });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWithin = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);

const hasGitSegment = (path: string): boolean => path.split("/").includes(".git");

/** The lexical and the real path of a tool's path argument. */
const resolvePaths = (
  ctx: LiveGateContext,
  raw: unknown,
): { readonly lexical: string; readonly real: string } | undefined => {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const lexical = absolutePath(ctx.workspaceRoot, raw);
  return { lexical, real: absolutePath("/", ctx.realpath(lexical)) };
};

const refusal = (ctx: LiveGateContext, path: string): string | undefined => {
  if (hasGitSegment(path)) return "git's internals are the engine's.";
  const root = ctx.refusedRoots.find((refused) => isWithin(path, refused));
  return root === undefined ? undefined : `${root} is not the crew's to read or write.`;
};

const decideRead = (ctx: LiveGateContext, raw: unknown): GateDecision => {
  const paths = resolvePaths(ctx, raw);
  if (!paths) return deny("Give the file's absolute path.");
  const refused = refusal(ctx, paths.lexical) ?? refusal(ctx, paths.real);
  return refused ? deny(refused) : allow;
};

/** A search root must be given, and must not hold a refused root below it. */
const decideSearch = (ctx: LiveGateContext, raw: unknown): GateDecision => {
  const paths = resolvePaths(ctx, raw);
  if (!paths) return deny("Give a path to search in, inside a service's directory.");
  const read = decideRead(ctx, raw);
  if (read.kind === "deny") return read;
  const holds = ctx.refusedRoots.find(
    (refused) => isWithin(refused, paths.lexical) || isWithin(refused, paths.real),
  );
  return holds
    ? deny(`Searching ${paths.lexical} would read ${holds}; search inside a service's directory.`)
    : allow;
};

const globPattern = (glob: string): RegExp => {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
};

/** A glob matches a path, or a directory the path lies under. */
const matchesGlob = (relative: string, glob: string): boolean => {
  const pattern = globPattern(glob.replace(/\/+$/u, ""));
  const segments = relative.split("/");
  return segments.some((_, index) => pattern.test(segments.slice(0, index + 1).join("/")));
};

const decideWrite = (ctx: LiveGateContext, raw: unknown): GateDecision => {
  const { lane } = ctx.member;
  if (ctx.member.kind !== "writer" || lane === undefined) {
    return deny("A read-only crewmate never changes files.");
  }
  const paths = resolvePaths(ctx, raw);
  if (!paths) return deny("Give the file's absolute path.");
  const refused = refusal(ctx, paths.lexical) ?? refusal(ctx, paths.real);
  if (refused) return deny(refused);
  if (!isWithin(paths.lexical, lane.mountDir) || !isWithin(paths.real, lane.mountDir)) {
    return deny(`Change files only in your copy of the code, ${lane.mountDir}/.`);
  }
  const relative = paths.real.slice(lane.mountDir.length + 1);
  const owned = ctx.foreignMigrations.find((glob) => matchesGlob(relative, glob));
  return owned ? deny(`${relative} is under ${owned}, which another crewmate owns.`) : allow;
};

/**
 * Split a command into words the way the zcp container's shell would, or
 * undefined when it is more than plain words: an operator, a redirection, an
 * unquoted expansion or glob. Inside double quotes `$` and backticks stay
 * literal — the rewritten command single-quotes the payload, so they expand on
 * the service, in the copy.
 */
const shellWords = (command: string): ReadonlyArray<string> | undefined => {
  const words: Array<string> = [];
  let current = "";
  let inWord = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end < 0) return undefined;
      current += command.slice(index + 1, end);
      index = end;
      inWord = true;
    } else if (char === '"') {
      index += 1;
      while (index < command.length && command[index] !== '"') {
        if (command[index] === "\\" && '$`"\\\n'.includes(command[index + 1] ?? "")) index += 1;
        current += command[index];
        index += 1;
      }
      if (index >= command.length) return undefined;
      inWord = true;
    } else if (char === "\\") {
      if (index + 1 >= command.length) return undefined;
      index += 1;
      current += command[index];
      inWord = true;
    } else if (/\s/u.test(char)) {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
    } else if (";&|<>()`$*?[]{}~#!".includes(char)) {
      return undefined;
    } else {
      current += char;
      inWord = true;
    }
  }
  if (inWord) words.push(current);
  return words;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Characters that end a path inside a payload. */
const PATH_END = `\\s'";&|()<>`;

/** Git subcommands that only read. */
const GIT_READ_ONLY = new Set([
  "status",
  "log",
  "diff",
  "show",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "describe",
  "shortlog",
  "cat-file",
  "merge-base",
  "name-rev",
  "for-each-ref",
  "version",
  "help",
]);
/** Global options that change nothing about where or how git writes. */
const GIT_HARMLESS_OPTIONS = new Set([
  "--no-pager",
  "-P",
  "--no-optional-locks",
  "--literal-pathspecs",
]);

/** The first git invocation in a payload that is not read-only, if any. */
const gitRefusal = (payload: string): string | undefined => {
  for (const match of payload.matchAll(/(?:^|[\s;&|(`'"])git(?=\s|$)/gu)) {
    const rest = payload.slice(match.index + match[0].length).split(/[;&|()\n]/u)[0] ?? "";
    const tokens = rest
      .trim()
      .split(/\s+/u)
      .filter((token) => token.length > 0)
      .map((token) => token.replace(/^['"]|['"]$/gu, ""));
    let index = 0;
    while (GIT_HARMLESS_OPTIONS.has(tokens[index] ?? "")) index += 1;
    const subcommand = tokens[index];
    if (subcommand === undefined || subcommand === "--version" || subcommand === "--help") continue;
    if (!GIT_READ_ONLY.has(subcommand)) {
      return `git ${subcommand} is the engine's: it commits, merges and lands your work. Read history only.`;
    }
  }
  return undefined;
};

/** Why a payload reaches outside the crewmate's copy, if it does. */
const laneEscape = (payload: string, lane: CrewLane): string | undefined => {
  const outside = `Stay in your copy, ${lane.remoteDir}.`;
  const rootPaths = new RegExp(
    `${escapeRegExp(lane.remoteRoot)}(?=[/${PATH_END}]|$)[^${PATH_END}]*`,
    "gu",
  );
  for (const match of payload.matchAll(rootPaths)) {
    if (!isWithin(absolutePath("/", match[0]), lane.remoteDir)) return outside;
  }
  if (new RegExp(`(?:^|[${PATH_END}=:])\\.\\.(?=/|$|[${PATH_END}])`, "u").test(payload))
    return outside;
  if (new RegExp(`(?:^|[${PATH_END}=:/])\\.git(?=/|$|[${PATH_END}])`, "u").test(payload)) {
    return "git's internals are the engine's.";
  }
  for (const match of payload.matchAll(
    /(?:^|[\s;&|(])(?:cd|pushd)(?=[\s;&|)]|$)\s*([^\s;&|)]*)/gu,
  )) {
    const target = (match[1] ?? "").replace(/^['"]|['"]$/gu, "");
    if (
      target === "" ||
      target.startsWith("~") ||
      target.startsWith("$") ||
      target.startsWith("-")
    ) {
      return outside;
    }
    if (target.startsWith("/") && !isWithin(absolutePath("/", target), lane.remoteDir)) {
      return outside;
    }
  }
  return undefined;
};

const decideCommand = (ctx: LiveGateContext, args: Record<string, unknown>): GateDecision => {
  const { lane } = ctx.member;
  if (ctx.member.kind !== "writer" || lane === undefined) {
    return deny("A read-only crewmate runs no commands.");
  }
  const form = `Run commands as ssh ${lane.host} "<command>"; they run in your copy.`;
  const words = typeof args.command === "string" ? shellWords(args.command) : undefined;
  if (!words || words[0] !== "ssh" || words.length < 3) return deny(form);
  if (words[1] !== lane.host) return deny(form);
  const payload = words
    .slice(2)
    .join(" ")
    .replace(new RegExp(`^\\s*cd\\s+${escapeRegExp(lane.remoteRoot)}/?\\s*(?:&&|;)\\s*`, "u"), "");
  const refused = laneEscape(payload, lane) ?? gitRefusal(payload);
  if (refused) return deny(refused);
  const assignments = [
    ...(ctx.member.crewPort === undefined ? [] : [`CREW_PORT=${ctx.member.crewPort}`]),
    ...Object.entries(ctx.member.env).map(([name, value]) => `${name}=${shellQuote(value)}`),
  ];
  const inner = [
    `cd ${shellQuote(lane.remoteDir)} &&`,
    ...assignments,
    `timeout ${ctx.payloadTimeoutSeconds} sh -c ${shellQuote(payload)}`,
  ].join(" ");
  return {
    kind: "allow",
    updatedInput: { ...args, command: `ssh ${shellQuote(lane.host)} ${shellQuote(inner)}` },
  };
};

/**
 * `zerops_dev_server` exists for three short turns only (CONCEPT §3.3): the
 * after-land and release restarts run from the tree (no `workDir`), the claim
 * restart from the copy. Each names the port and the full command, so the
 * stop inside a restart can never `pkill` another server by its first token,
 * and none takes its own `logFile`, so what dev serves stays readable from
 * the default pidfile.
 */
const decideDevServer = (ctx: LiveGateContext, args: Record<string, unknown>): GateDecision => {
  const { lane } = ctx.member;
  if (ctx.turn === "work" || lane === undefined) {
    return deny("The dev server is the person's; ask to show your work on dev instead.");
  }
  const expected = ctx.devServer;
  if (expected === undefined) return deny("The dev server's command is not known yet.");
  const workDir = ctx.turn === "claim-start" ? lane.remoteDir : undefined;
  const shape =
    args.action === "restart" &&
    args.hostname === lane.host &&
    args.port === expected.port &&
    args.processMatch === expected.command &&
    (args.command === undefined || args.command === expected.command) &&
    args.logFile === undefined &&
    args.workDir === workDir;
  return shape
    ? allow
    : deny(
        `Restart exactly: action=restart hostname=${lane.host} port=${expected.port} ` +
          `processMatch="${expected.command}"${workDir ? ` workDir=${workDir}` : " and no workDir"}.`,
      );
};

const decideZerops = (ctx: LiveGateContext, tool: string, input: unknown): GateDecision => {
  if (ZEROPS_READ_ONLY.has(tool)) return allow;
  const args = isRecord(input) ? input : {};
  const underClaim = ctx.holdsClaim && ctx.member.lane !== undefined;
  switch (tool) {
    case "zerops_dev_server":
      return decideDevServer(ctx, args);
    case "zerops_verify":
      return underClaim && args.serviceHostname === ctx.member.lane?.host
        ? allow
        : deny("Verify only your own host while dev shows your work.");
    case "zerops_browser":
      return underClaim ? allow : deny("The browser is for while dev shows your work.");
    case "zerops_workflow":
      return args.action === "status"
        ? allow
        : deny("A crewmate reads the workflow's status only.");
    case "zerops_deploy":
      return deny("Deploys are the person's; your work reaches the tree when it lands.");
    default:
      return deny(`${tool} is not available to a crewmate.`);
  }
};

export const decideCrewTool = (ctx: GateContext, call: GateToolCall): GateDecision => {
  if (ctx.kind === "deny-all") {
    return deny("This crew conversation is retired; nothing runs in it.");
  }
  const { toolName, input } = call;
  const args = isRecord(input) ? input : {};
  if (ALWAYS_ALLOWED.has(toolName) || toolName.startsWith(CREW_TOOL_PREFIX)) return allow;
  if (toolName.startsWith(ZEROPS_TOOL_PREFIX)) {
    return decideZerops(ctx, toolName.slice(ZEROPS_TOOL_PREFIX.length), input);
  }
  switch (toolName) {
    case "Read":
      return decideRead(ctx, args.file_path);
    case "Glob":
    case "Grep":
      return decideSearch(ctx, args.path);
    case "Write":
    case "Edit":
    case "MultiEdit":
      return decideWrite(ctx, args.file_path);
    case "NotebookEdit":
      return decideWrite(ctx, args.notebook_path);
    case "Bash":
      return decideCommand(ctx, args);
    case "AskUserQuestion":
      return deny("Ask through crew_report with a question; the person answers it there.");
    default:
      return deny(`${toolName} is not available to a crewmate.`);
  }
};
