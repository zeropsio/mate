import { describe, expect, it } from "@effect/vitest";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { crewLane } from "./CrewDefinition.ts";
import {
  crewExactCommandRule,
  crewRefusedRoots,
  decideCrewTool,
  type GateDecision,
  type LiveGateContext,
} from "./CrewPolicy.ts";

const lane = crewLane(
  { host: "appdev", mountPath: "/var/www/appdev", remotePath: "/var/www" },
  "backend",
);

/** Symlinks the fake filesystem resolves, longest prefix first. */
const SYMLINKS: ReadonlyArray<readonly [string, string]> = [
  ["/var/www/appdev/.crew/backend/escape", "/var/www/appdev/src"],
  ["/var/www/appdev/.crew/backend/crewfiles", "/var/www/.mate/crew/game"],
  ["/var/www/appdev/.crew/backend/sneaky", "/var/www/appdev/.crew/backend/.git"],
  ["/var/www/appdev/docs-link", "/var/www/appdev/.crew/backend/docs"],
];
const realpath = (path: string): string => {
  for (const [link, target] of SYMLINKS) {
    if (path === link || path.startsWith(`${link}/`)) return target + path.slice(link.length);
  }
  return path;
};

const writer: LiveGateContext = {
  kind: "live",
  member: {
    handle: "backend",
    kind: "writer",
    lane,
    crewPort: 3001,
    env: { DATABASE_URL: "postgres://db/backend" },
  },
  foreignMigrations: ["db/migrations/**"],
  refusedRoots: crewRefusedRoots({ workspaceRoot: "/var/www", home: "/home/zerops" }),
  realpath,
  workspaceRoot: "/var/www",
  turn: "work",
  holdsClaim: false,
  payloadTimeoutSeconds: 600,
};
const reader: LiveGateContext = {
  ...writer,
  member: { handle: "erik", kind: "reader", env: {} },
  foreignMigrations: [],
};
const lead: LiveGateContext = { ...reader, member: { handle: "lead", kind: "lead", env: {} } };

const ALLOW = { kind: "allow" } as const;
const DENY = { kind: "deny", reason: expect.any(String) } as const;

type Row = readonly [
  string,
  LiveGateContext,
  string,
  Record<string, unknown>,
  GateDecision | typeof DENY,
];

const check = (rows: ReadonlyArray<Row>) =>
  it.each(rows)("%s", (_name, ctx, toolName, input, decision) => {
    expect(decideCrewTool(ctx, { toolName, input })).toEqual(decision);
  });

describe("decideCrewTool — every crew thread", () => {
  check([
    ["ToolSearch", reader, "ToolSearch", { query: "select:Read" }, ALLOW],
    ["TodoWrite", reader, "TodoWrite", { todos: [] }, ALLOW],
    ["a crew tool", reader, "mcp__crew__crew_report", { status: "done" }, ALLOW],
    ["Read in the Mate's tree", reader, "Read", { file_path: "/var/www/appdev/src/app.ts" }, ALLOW],
    [
      "Read in a crewmate's copy",
      reader,
      "Read",
      { file_path: "/var/www/appdev/.crew/backend/src/app.ts" },
      ALLOW,
    ],
    [
      "Read through a symlink that lands in a copy",
      reader,
      "Read",
      { file_path: "/var/www/appdev/docs-link/a.md" },
      ALLOW,
    ],
    [
      "Read of the crew home",
      reader,
      "Read",
      { file_path: "/var/www/.mate/crew/game/brief.md" },
      DENY,
    ],
    [
      "Read of the crew home through a symlink",
      writer,
      "Read",
      { file_path: "/var/www/appdev/.crew/backend/crewfiles/brief.md" },
      DENY,
    ],
    ["Read of zcp's state", reader, "Read", { file_path: "/var/www/.zcp/state.json" }, DENY],
    [
      "Read of ~/.claude",
      reader,
      "Read",
      { file_path: "/home/zerops/.claude/settings.json" },
      DENY,
    ],
    ["Read of ~/.codex", reader, "Read", { file_path: "/home/zerops/.codex/auth.json" }, DENY],
    ["Read of ~/.t3", reader, "Read", { file_path: "/home/zerops/.t3/state.sqlite" }, DENY],
    ["Read of /proc", reader, "Read", { file_path: "/proc/1/environ" }, DENY],
    ["Read of a .git internal", reader, "Read", { file_path: "/var/www/appdev/.git/config" }, DENY],
    [
      "Read of a .git internal through a symlink",
      writer,
      "Read",
      { file_path: "/var/www/appdev/.crew/backend/sneaky/HEAD" },
      DENY,
    ],
    [
      "Read that climbs out with ..",
      reader,
      "Read",
      { file_path: "/var/www/appdev/../.mate/crew/game/brief.md" },
      DENY,
    ],
    ["Read without a path", reader, "Read", {}, DENY],
    [
      "Grep inside a service",
      reader,
      "Grep",
      { pattern: "TODO", path: "/var/www/appdev/.crew/backend" },
      ALLOW,
    ],
    [
      "Grep over the whole workspace, crew home included",
      reader,
      "Grep",
      { pattern: "TODO", path: "/var/www" },
      DENY,
    ],
    ["Grep without a path searches the workspace", reader, "Grep", { pattern: "TODO" }, DENY],
    [
      "Glob inside a service",
      reader,
      "Glob",
      { pattern: "**/*.ts", path: "/var/www/appdev/src" },
      ALLOW,
    ],
    [
      "AskUserQuestion goes through crew_report",
      writer,
      "AskUserQuestion",
      { questions: [] },
      DENY,
    ],
    [
      "a read-only zcp tool",
      reader,
      "mcp__zerops__zerops_logs",
      { serviceHostname: "appdev" },
      ALLOW,
    ],
    ["zerops_discover", lead, "mcp__zerops__zerops_discover", {}, ALLOW],
    ["zerops_knowledge", writer, "mcp__zerops__zerops_knowledge", { query: "nodejs" }, ALLOW],
    ["zerops_workflow status", writer, "mcp__zerops__zerops_workflow", { action: "status" }, ALLOW],
    ["zerops_workflow start", writer, "mcp__zerops__zerops_workflow", { action: "start" }, DENY],
    [
      "zerops_deploy (deploys are the person's)",
      writer,
      "mcp__zerops__zerops_deploy",
      { targetService: "appstage" },
      DENY,
    ],
    ["a mutating zcp tool", writer, "mcp__zerops__zerops_manage", { action: "restart" }, DENY],
    ["a tool nobody listed", writer, "WebFetch", { url: "https://example.com" }, DENY],
    ["another MCP server's tool", writer, "mcp__t3-code__browser_open", {}, DENY],
  ]);
});

describe("decideCrewTool — file writes", () => {
  const inCopy = "/var/www/appdev/.crew/backend";
  check([
    [
      "Write in its own copy",
      writer,
      "Write",
      { file_path: `${inCopy}/src/api.ts`, content: "x" },
      ALLOW,
    ],
    ["Edit in its own copy", writer, "Edit", { file_path: `${inCopy}/src/api.ts` }, ALLOW],
    [
      "MultiEdit in its own copy",
      writer,
      "MultiEdit",
      { file_path: `${inCopy}/src/api.ts` },
      ALLOW,
    ],
    [
      "NotebookEdit in its own copy",
      writer,
      "NotebookEdit",
      { notebook_path: `${inCopy}/nb.ipynb` },
      ALLOW,
    ],
    ["its own migrations", writer, "Write", { file_path: `${inCopy}/migrations/001.sql` }, ALLOW],
    [
      "Write in the Mate's tree",
      writer,
      "Write",
      { file_path: "/var/www/appdev/src/api.ts" },
      DENY,
    ],
    [
      "Write in another crewmate's copy",
      writer,
      "Edit",
      { file_path: "/var/www/appdev/.crew/frontend/a.ts" },
      DENY,
    ],
    [
      "Write through a symlink out of the copy",
      writer,
      "Write",
      { file_path: `${inCopy}/escape/api.ts` },
      DENY,
    ],
    [
      "Write through a symlink into the crew home",
      writer,
      "Write",
      { file_path: `${inCopy}/crewfiles/brief.md` },
      DENY,
    ],
    [
      "Write through a symlink into the copy",
      writer,
      "Write",
      { file_path: "/var/www/appdev/docs-link/a.md" },
      DENY,
    ],
    [
      "Write climbing out with ..",
      writer,
      "Write",
      { file_path: `${inCopy}/../frontend/a.ts` },
      DENY,
    ],
    ["Write to the copy's .git", writer, "Write", { file_path: `${inCopy}/.git` }, DENY],
    [
      "Write on another crewmate's migrations",
      writer,
      "Write",
      { file_path: `${inCopy}/db/migrations/002.sql` },
      DENY,
    ],
    [
      "Write on a deeper path under another's migrations",
      writer,
      "Edit",
      { file_path: `${inCopy}/db/migrations/v2/003.sql` },
      DENY,
    ],
    [
      "Write near, not under, another's migrations",
      writer,
      "Edit",
      { file_path: `${inCopy}/db/migrations.md` },
      ALLOW,
    ],
    ["Write by a reader", reader, "Write", { file_path: `${inCopy}/a.ts` }, DENY],
    ["Edit by the lead", lead, "Edit", { file_path: `${inCopy}/a.ts` }, DENY],
    [
      "NotebookEdit by a reader",
      reader,
      "NotebookEdit",
      { notebook_path: `${inCopy}/nb.ipynb` },
      DENY,
    ],
  ]);
});

describe("decideCrewTool — commands", () => {
  /** A payload always goes into the lane form single-quoted, one word or many. */
  const singleQuoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
  /** What the gate hands the CLI instead: the payload wrapped to run in the copy. */
  const plainWriter: LiveGateContext = {
    ...writer,
    member: { handle: "backend", kind: "writer", lane, env: {} },
  };
  const wrapped = (
    payload: string,
    ctx: LiveGateContext = writer,
  ): { kind: "allow"; updatedInput: Record<string, unknown> } => {
    const prefix = [
      ...(ctx.member.crewPort === undefined ? [] : [`CREW_PORT=${ctx.member.crewPort}`]),
      ...Object.entries(ctx.member.env).map(([name, value]) => `${name}=${shellQuote(value)}`),
    ];
    const inner = [
      "cd /var/www/.crew/backend &&",
      ...prefix,
      `timeout ${ctx.payloadTimeoutSeconds} sh -c ${singleQuoted(payload)}`,
    ].join(" ");
    return { kind: "allow", updatedInput: { command: `ssh appdev ${shellQuote(inner)}` } };
  };

  check([
    [
      "the project guidance's form, prefix dropped",
      writer,
      "Bash",
      { command: 'ssh appdev "cd /var/www && npm test"' },
      wrapped("npm test"),
    ],
    [
      "the semicolon form",
      writer,
      "Bash",
      { command: "ssh appdev 'cd /var/www; npm run lint'" },
      wrapped("npm run lint"),
    ],
    [
      "no prefix",
      writer,
      "Bash",
      { command: 'ssh appdev "npm run build"' },
      wrapped("npm run build"),
    ],
    [
      "unquoted words, joined as ssh joins them",
      writer,
      "Bash",
      { command: "ssh appdev ls -la src" },
      wrapped("ls -la src"),
    ],
    [
      "escaped quotes inside double quotes",
      writer,
      "Bash",
      { command: 'ssh appdev "echo \\"hi\\" > out.txt"' },
      wrapped('echo "hi" > out.txt'),
    ],
    [
      "a path in its own copy on the service",
      writer,
      "Bash",
      { command: 'ssh appdev "ls /var/www/.crew/backend/src"' },
      wrapped("ls /var/www/.crew/backend/src"),
    ],
    [
      "read-only git",
      writer,
      "Bash",
      { command: 'ssh appdev "git status && git log -5 --oneline && git diff HEAD~1..HEAD"' },
      wrapped("git status && git log -5 --oneline && git diff HEAD~1..HEAD"),
    ],
    [
      "git with a harmless global option",
      writer,
      "Bash",
      { command: 'ssh appdev "git --no-pager show HEAD"' },
      wrapped("git --no-pager show HEAD"),
    ],
    [
      "a file that only starts with .git",
      writer,
      "Bash",
      { command: 'ssh appdev "cat .gitignore"' },
      wrapped("cat .gitignore"),
    ],
    [
      "other Bash fields survive the rewrite",
      writer,
      "Bash",
      { command: 'ssh appdev "npm test"', timeout: 60000, description: "tests" },
      {
        kind: "allow",
        updatedInput: { ...wrapped("npm test").updatedInput, timeout: 60000, description: "tests" },
      },
    ],
    [
      "no crew port and no env",
      plainWriter,
      "Bash",
      { command: 'ssh appdev "npm test"' },
      wrapped("npm test", plainWriter),
    ],
    [
      "a command already in its lane form runs as it is",
      writer,
      "Bash",
      wrapped("npm test").updatedInput,
      ALLOW,
    ],
    [
      "a one-word command in its lane form, single-quoted like any other",
      writer,
      "Bash",
      wrapped("ls").updatedInput,
      ALLOW,
    ],
    [
      "a command with a quote in its lane form",
      writer,
      "Bash",
      wrapped("echo it's done").updatedInput,
      ALLOW,
    ],
    [
      "a lane form keeps its other Bash fields",
      writer,
      "Bash",
      { ...wrapped("npm test").updatedInput, timeout: 60000 },
      ALLOW,
    ],
    [
      "a lane form still stays in the copy",
      writer,
      "Bash",
      wrapped("cd .. && ls").updatedInput,
      DENY,
    ],
    [
      "a lane form still reads history only",
      writer,
      "Bash",
      wrapped("git push").updatedInput,
      DENY,
    ],
    [
      "a lane form with another timeout is wrapped again",
      writer,
      "Bash",
      {
        command: String(wrapped("npm test").updatedInput.command).replace(
          "timeout 600",
          "timeout 9999",
        ),
      },
      wrapped(
        "cd /var/www/.crew/backend && CREW_PORT=3001 DATABASE_URL=postgres://db/backend timeout 9999 sh -c 'npm test'",
      ),
    ],
    [
      "a lane form quoted another way is wrapped again",
      writer,
      "Bash",
      {
        command:
          "ssh appdev \"cd /var/www/.crew/backend && CREW_PORT=3001 DATABASE_URL=postgres://db/backend timeout 600 sh -c 'npm test'\"",
      },
      wrapped(
        "cd /var/www/.crew/backend && CREW_PORT=3001 DATABASE_URL=postgres://db/backend timeout 600 sh -c 'npm test'",
      ),
    ],
    ["a command on the zcp container", writer, "Bash", { command: "npm test" }, DENY],
    ["another host", writer, "Bash", { command: 'ssh apidev "npm test"' }, DENY],
    ["ssh options", writer, "Bash", { command: 'ssh -o ProxyCommand=x appdev "ls"' }, DENY],
    [
      "a second command after ssh",
      writer,
      "Bash",
      { command: 'ssh appdev "ls" && rm -rf /var/www/.mate' },
      DENY,
    ],
    ["an unquoted expansion", writer, "Bash", { command: "ssh appdev $(cat x)" }, DENY],
    ["ssh without a command", writer, "Bash", { command: "ssh appdev" }, DENY],
    [
      "the Mate's own tree on the service",
      writer,
      "Bash",
      { command: 'ssh appdev "cat /var/www/src/app.ts"' },
      DENY,
    ],
    [
      "another crewmate's copy",
      writer,
      "Bash",
      { command: 'ssh appdev "ls /var/www/.crew/frontend"' },
      DENY,
    ],
    [
      "cd to the Mate's tree later in the payload",
      writer,
      "Bash",
      { command: 'ssh appdev "npm test && cd /var/www && ls"' },
      DENY,
    ],
    ["climbing out with ..", writer, "Bash", { command: 'ssh appdev "cd .. && ls"' }, DENY],
    [
      "reading a sibling with ../",
      writer,
      "Bash",
      { command: 'ssh appdev "cat ../frontend/a.ts"' },
      DENY,
    ],
    ["git's internals", writer, "Bash", { command: 'ssh appdev "cat .git/config"' }, DENY],
    ...[
      "commit -am x",
      "add -A",
      "reset --hard",
      "checkout main",
      "merge crew/frontend",
      "push",
      "stash",
      "branch x",
      "worktree add ../x",
      "rebase main",
      "pull",
      "fetch",
    ].map(
      (sub) =>
        [`git ${sub}`, writer, "Bash", { command: `ssh appdev "git ${sub}"` }, DENY] as const,
    ),
    [
      "git after the dropped prefix",
      writer,
      "Bash",
      { command: 'ssh appdev "cd /var/www && npm test && git commit -m wip"' },
      DENY,
    ],
    [
      "git -C into another tree",
      writer,
      "Bash",
      { command: 'ssh appdev "git -C /tmp status"' },
      DENY,
    ],
    [
      "git -c to change config",
      writer,
      "Bash",
      { command: 'ssh appdev "git -c core.hooksPath=x status"' },
      DENY,
    ],
    ["a reader runs nothing", reader, "Bash", { command: 'ssh appdev "ls"' }, DENY],
    ["the lead runs nothing", lead, "Bash", { command: 'ssh appdev "ls"' }, DENY],
  ]);
});

describe("crewExactCommandRule — the lane form, for a driver that cannot rewrite a command", () => {
  it("gives a writer its lane form, and its example runs as it is", () => {
    const rule = crewExactCommandRule(writer)!;
    const form =
      "ssh appdev 'cd /var/www/.crew/backend && CREW_PORT=3001 DATABASE_URL=postgres://db/backend timeout 600 sh -c '\\''<command>'\\'''";
    expect(rule).toContain(form);
    const example = form.replace("<command>", "npm test");
    expect(rule).toContain(example);
    expect(decideCrewTool(writer, { toolName: "Bash", input: { command: example } })).toEqual(
      ALLOW,
    );
  });

  it.each([
    ["a reader", reader],
    ["the lead", lead],
    ["a thread without a live stint", { kind: "deny-all" } as const],
  ] as const)("gives %s none: it runs no commands", (_name, ctx) => {
    expect(crewExactCommandRule(ctx)).toBeUndefined();
  });
});

describe("decideCrewTool — the dev server and a claim", () => {
  const devServer = { port: 3000, command: "npm run dev -- --host 0.0.0.0" };
  const shaped = (turn: LiveGateContext["turn"]): LiveGateContext => ({
    ...writer,
    turn,
    devServer,
  });
  const holder: LiveGateContext = { ...shaped("claim-start"), holdsClaim: true };
  const restart = {
    action: "restart",
    hostname: "appdev",
    port: 3000,
    processMatch: "npm run dev -- --host 0.0.0.0",
  };
  const fromCopy = { ...restart, workDir: "/var/www/.crew/backend" };
  const tool = "mcp__zerops__zerops_dev_server";

  check([
    ["the after-land restart from the tree", shaped("after-land"), tool, restart, ALLOW],
    [
      "the after-land restart with its command spelled out",
      shaped("after-land"),
      tool,
      { ...restart, command: devServer.command },
      ALLOW,
    ],
    ["the release restart from the tree", shaped("claim-release"), tool, restart, ALLOW],
    ["the claim restart from the copy", holder, tool, fromCopy, ALLOW],
    ["any dev server call in an ordinary turn", writer, tool, restart, DENY],
    [
      "a status call in an ordinary turn",
      writer,
      tool,
      { action: "status", hostname: "appdev" },
      DENY,
    ],
    ["after-land from the copy", shaped("after-land"), tool, fromCopy, DENY],
    ["the claim restart from the tree", holder, tool, restart, DENY],
    [
      "the claim restart from another copy",
      holder,
      tool,
      { ...fromCopy, workDir: "/var/www/.crew/frontend" },
      DENY,
    ],
    ["without a port", shaped("after-land"), tool, { ...restart, port: undefined }, DENY],
    ["on another port", shaped("after-land"), tool, { ...restart, port: 8080 }, DENY],
    [
      "without processMatch",
      shaped("after-land"),
      tool,
      { ...restart, processMatch: undefined },
      DENY,
    ],
    [
      "processMatch on the first token only",
      shaped("after-land"),
      tool,
      { ...restart, processMatch: "npm" },
      DENY,
    ],
    [
      "another command",
      shaped("after-land"),
      tool,
      { ...restart, command: "node server.js" },
      DENY,
    ],
    ["another host", shaped("after-land"), tool, { ...restart, hostname: "apidev" }, DENY],
    ["a stop", shaped("after-land"), tool, { ...restart, action: "stop" }, DENY],
    [
      "its own log file (a second pidfile)",
      shaped("after-land"),
      tool,
      { ...restart, logFile: "/tmp/x.log" },
      DENY,
    ],
    [
      "a shaped turn whose dev server is unknown",
      { ...writer, turn: "after-land" },
      tool,
      restart,
      DENY,
    ],
    [
      "a reader's claim-shaped turn",
      { ...reader, turn: "claim-start", devServer, holdsClaim: true },
      tool,
      fromCopy,
      DENY,
    ],
    [
      "zerops_verify under a claim",
      holder,
      "mcp__zerops__zerops_verify",
      { serviceHostname: "appdev" },
      ALLOW,
    ],
    [
      "zerops_verify without one",
      writer,
      "mcp__zerops__zerops_verify",
      { serviceHostname: "appdev" },
      DENY,
    ],
    [
      "zerops_verify of another host under a claim",
      holder,
      "mcp__zerops__zerops_verify",
      { serviceHostname: "apidev" },
      DENY,
    ],
    [
      "zerops_browser under a claim",
      holder,
      "mcp__zerops__zerops_browser",
      { url: "https://appdev" },
      ALLOW,
    ],
    [
      "zerops_browser without one",
      writer,
      "mcp__zerops__zerops_browser",
      { url: "https://appdev" },
      DENY,
    ],
  ]);
});

describe("decideCrewTool — a crew thread without a live stint", () => {
  it.each(["ToolSearch", "Read", "mcp__crew__crew_report", "mcp__zerops__zerops_logs"])(
    "denies %s",
    (toolName) => {
      expect(
        decideCrewTool(
          { kind: "deny-all" },
          { toolName, input: { file_path: "/var/www/appdev/a" } },
        ),
      ).toEqual(DENY);
    },
  );
});
