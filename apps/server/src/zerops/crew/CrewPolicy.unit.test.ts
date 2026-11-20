import { expect, it } from "vite-plus/test";

import { shellQuote } from "../ZeropsWorkspaceAccess.ts";
import { crewLane } from "./CrewDefinition.ts";
import { crewRefusedRoots, decideCrewTool, type LiveGateContext } from "./CrewPolicy.ts";

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
const decision = (ctx: LiveGateContext, toolName: string, input: Record<string, unknown>) =>
  decideCrewTool(ctx, { toolName, input });

// witness: apps/server/src/zerops/crew/CrewPolicy.ts | if (hasGitSegment(path)) return → if (path.endsWith("/.git")) return
it("CM43: A crewmate reads and searches only inside the services' trees and the crewmates' copies: the crew home, zcp's state, the agents' homes, /proc and Git's internals are refused, through a symlink or .. too, and a search with no path is refused", () => {
  expect(decision(reader, "Read", { file_path: "/var/www/appdev/src/app.ts" }).kind).toBe("allow");
  expect(
    decision(reader, "Read", { file_path: "/var/www/appdev/.crew/backend/src/app.ts" }).kind,
  ).toBe("allow");
  expect(decision(reader, "Read", { file_path: "/var/www/appdev/docs-link/a.md" }).kind).toBe(
    "allow",
  );
  expect(decision(reader, "Read", { file_path: "/var/www/.mate/crew/game/brief.md" }).kind).toBe(
    "deny",
  );
  expect(
    decision(writer, "Read", { file_path: "/var/www/appdev/.crew/backend/crewfiles/brief.md" })
      .kind,
  ).toBe("deny");
  expect(decision(reader, "Read", { file_path: "/var/www/.zcp/state.json" }).kind).toBe("deny");
  expect(decision(reader, "Read", { file_path: "/home/zerops/.claude/settings.json" }).kind).toBe(
    "deny",
  );
  expect(decision(reader, "Read", { file_path: "/home/zerops/.codex/auth.json" }).kind).toBe(
    "deny",
  );
  expect(decision(reader, "Read", { file_path: "/home/zerops/.t3/state.sqlite" }).kind).toBe(
    "deny",
  );
  expect(decision(reader, "Read", { file_path: "/proc/1/environ" }).kind).toBe("deny");
  expect(decision(reader, "Read", { file_path: "/var/www/appdev/.git/config" }).kind).toBe("deny");
  expect(
    decision(writer, "Read", { file_path: "/var/www/appdev/.crew/backend/sneaky/HEAD" }).kind,
  ).toBe("deny");
  expect(
    decision(reader, "Read", { file_path: "/var/www/appdev/../.mate/crew/game/brief.md" }).kind,
  ).toBe("deny");
  expect(decision(reader, "Read", {}).kind).toBe("deny");
  expect(
    decision(reader, "Grep", { pattern: "TODO", path: "/var/www/appdev/.crew/backend" }).kind,
  ).toBe("allow");
  expect(decision(reader, "Grep", { pattern: "TODO", path: "/var/www" }).kind).toBe("deny");
  expect(decision(reader, "Grep", { pattern: "TODO" }).kind).toBe("deny");
  expect(decision(reader, "Glob", { pattern: "**/*.ts", path: "/var/www/appdev/src" }).kind).toBe(
    "allow",
  );
});

// witness: apps/server/src/zerops/crew/CrewPolicy.ts | !isWithin(paths.lexical, lane.mountDir) || !isWithin(paths.real, lane.mountDir) → !isWithin(paths.lexical, lane.mountDir)
it("CM44: A writer changes files only inside its own copy, never in the Mate's tree, another crewmate's copy or migrations, its copy's .git, or through a symlink or .. out of it, and a reader and the lead change no file", () => {
  const inCopy = "/var/www/appdev/.crew/backend";
  expect(decision(writer, "Write", { file_path: `${inCopy}/src/api.ts`, content: "x" }).kind).toBe(
    "allow",
  );
  expect(decision(writer, "Edit", { file_path: `${inCopy}/src/api.ts` }).kind).toBe("allow");
  expect(decision(writer, "MultiEdit", { file_path: `${inCopy}/src/api.ts` }).kind).toBe("allow");
  expect(decision(writer, "NotebookEdit", { notebook_path: `${inCopy}/nb.ipynb` }).kind).toBe(
    "allow",
  );
  expect(decision(writer, "Write", { file_path: `${inCopy}/migrations/001.sql` }).kind).toBe(
    "allow",
  );
  expect(decision(writer, "Write", { file_path: "/var/www/appdev/src/api.ts" }).kind).toBe("deny");
  expect(decision(writer, "Edit", { file_path: "/var/www/appdev/.crew/frontend/a.ts" }).kind).toBe(
    "deny",
  );
  expect(decision(writer, "Write", { file_path: `${inCopy}/escape/api.ts` }).kind).toBe("deny");
  expect(decision(writer, "Write", { file_path: `${inCopy}/crewfiles/brief.md` }).kind).toBe(
    "deny",
  );
  expect(decision(writer, "Write", { file_path: "/var/www/appdev/docs-link/a.md" }).kind).toBe(
    "deny",
  );
  expect(decision(writer, "Write", { file_path: `${inCopy}/../frontend/a.ts` }).kind).toBe("deny");
  expect(decision(writer, "Write", { file_path: `${inCopy}/.git` }).kind).toBe("deny");
  expect(decision(writer, "Write", { file_path: `${inCopy}/db/migrations/002.sql` }).kind).toBe(
    "deny",
  );
  expect(decision(writer, "Edit", { file_path: `${inCopy}/db/migrations/v2/003.sql` }).kind).toBe(
    "deny",
  );
  expect(decision(writer, "Edit", { file_path: `${inCopy}/db/migrations.md` }).kind).toBe("allow");
  expect(decision(reader, "Write", { file_path: `${inCopy}/a.ts` }).kind).toBe("deny");
  expect(decision(lead, "Edit", { file_path: `${inCopy}/a.ts` }).kind).toBe("deny");
  expect(decision(reader, "NotebookEdit", { notebook_path: `${inCopy}/nb.ipynb` }).kind).toBe(
    "deny",
  );
});

// witness: apps/server/src/zerops/crew/CrewPolicy.ts | if (ZEROPS_READ_ONLY.has(tool)) return allow; → if (ctx.member.kind === "reader" && ZEROPS_READ_ONLY.has(tool)) return allow;
it("CM45: A crewmate uses only zcp's read-only tools and the workflow's status: a deploy, a workflow start, a mutating zcp tool, a tool nobody listed and another MCP server's tool are refused", () => {
  expect(decision(reader, "mcp__zerops__zerops_logs", { serviceHostname: "appdev" }).kind).toBe(
    "allow",
  );
  expect(decision(lead, "mcp__zerops__zerops_discover", {}).kind).toBe("allow");
  expect(decision(writer, "mcp__zerops__zerops_knowledge", { query: "nodejs" }).kind).toBe("allow");
  expect(decision(writer, "mcp__zerops__zerops_workflow", { action: "status" }).kind).toBe("allow");
  expect(decision(writer, "mcp__zerops__zerops_workflow", { action: "start" }).kind).toBe("deny");
  expect(decision(writer, "mcp__zerops__zerops_deploy", { targetService: "appstage" }).kind).toBe(
    "deny",
  );
  expect(decision(writer, "mcp__zerops__zerops_manage", { action: "restart" }).kind).toBe("deny");
  expect(decision(writer, "WebFetch", { url: "https://example.com" }).kind).toBe("deny");
  expect(decision(writer, "mcp__t3-code__browser_open", {}).kind).toBe("deny");
});

// witness: apps/server/src/zerops/crew/CrewPolicy.ts | if (words[1] !== lane.host) return deny(form); → if (words[1]?.startsWith("-")) return deny(form);
it("CM46: A writer's command runs only through ssh into its own copy on its own service, rewritten to run there; a command on the zcp container, on another host, with ssh options, after a second command or through an unquoted expansion is refused, as is one reaching the Mate's tree, another copy, a sibling or Git's internals, and a reader and the lead run no command", () => {
  expect(
    decideCrewTool(writer, {
      toolName: "Bash",
      input: { command: 'ssh appdev "cd /var/www && npm test"' },
    }),
  ).toEqual({
    kind: "allow",
    updatedInput: {
      command:
        "ssh appdev 'cd /var/www/.crew/backend && CREW_PORT=3001 DATABASE_URL=postgres://db/backend timeout 600 sh -c '\\''npm test'\\'''",
    },
  });
  expect(decision(writer, "Bash", { command: "npm test" }).kind).toBe("deny");
  expect(decision(writer, "Bash", { command: 'ssh apidev "npm test"' }).kind).toBe("deny");
  expect(decision(writer, "Bash", { command: 'ssh -o ProxyCommand=x appdev "ls"' }).kind).toBe(
    "deny",
  );
  expect(
    decision(writer, "Bash", { command: 'ssh appdev "ls" && rm -rf /var/www/.mate' }).kind,
  ).toBe("deny");
  expect(decision(writer, "Bash", { command: "ssh appdev $(cat x)" }).kind).toBe("deny");
  expect(decision(writer, "Bash", { command: "ssh appdev" }).kind).toBe("deny");
  expect(decision(writer, "Bash", { command: 'ssh appdev "cat /var/www/src/app.ts"' }).kind).toBe(
    "deny",
  );
  expect(
    decision(writer, "Bash", { command: 'ssh appdev "ls /var/www/.crew/frontend"' }).kind,
  ).toBe("deny");
  expect(
    decision(writer, "Bash", { command: 'ssh appdev "npm test && cd /var/www && ls"' }).kind,
  ).toBe("deny");
  expect(decision(writer, "Bash", { command: 'ssh appdev "cd .. && ls"' }).kind).toBe("deny");
  expect(decision(writer, "Bash", { command: 'ssh appdev "cat ../frontend/a.ts"' }).kind).toBe(
    "deny",
  );
  expect(decision(writer, "Bash", { command: 'ssh appdev "cat .git/config"' }).kind).toBe("deny");
  expect(decision(reader, "Bash", { command: 'ssh appdev "ls"' }).kind).toBe("deny");
  expect(decision(lead, "Bash", { command: 'ssh appdev "ls"' }).kind).toBe("deny");
});

// witness: apps/server/src/zerops/crew/CrewPolicy.ts | if (!GIT_READ_ONLY.has(subcommand)) { → if (!GIT_READ_ONLY.has(subcommand) && subcommand !== "fetch") {
it("CM47: Git in a writer's copy only reads: a commit, add, reset, checkout, merge, push, stash, branch, worktree, rebase, pull or fetch, Git -C into another tree and -c are refused", () => {
  expect(
    decision(writer, "Bash", {
      command: 'ssh appdev "git status && git log -5 --oneline && git diff HEAD~1..HEAD"',
    }),
  ).toEqual({
    kind: "allow",
    updatedInput: {
      command:
        "ssh appdev 'cd /var/www/.crew/backend && CREW_PORT=3001 DATABASE_URL=postgres://db/backend timeout 600 sh -c '\\''git status && git log -5 --oneline && git diff HEAD~1..HEAD'\\'''",
    },
  });
  expect(decision(writer, "Bash", { command: 'ssh appdev "git --no-pager show HEAD"' })).toEqual({
    kind: "allow",
    updatedInput: {
      command:
        "ssh appdev 'cd /var/www/.crew/backend && CREW_PORT=3001 DATABASE_URL=postgres://db/backend timeout 600 sh -c '\\''git --no-pager show HEAD'\\'''",
    },
  });
  for (const subcommand of [
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
  ]) {
    expect(
      decision(writer, "Bash", { command: `ssh appdev "git ${subcommand}"` }).kind,
      subcommand,
    ).toBe("deny");
  }
  expect(decision(writer, "Bash", { command: 'ssh appdev "git -C /tmp status"' }).kind).toBe(
    "deny",
  );
  expect(
    decision(writer, "Bash", { command: 'ssh appdev "git -c core.hooksPath=x status"' }).kind,
  ).toBe("deny");
});

const devServer = { name: "web", port: 3000, command: "npm run dev -- --host 0.0.0.0", cwd: "." };
const shaped = (turn: LiveGateContext["turn"]): LiveGateContext => ({
  ...writer,
  turn,
  devServer,
});
const holder: LiveGateContext = { ...shaped("claim-start"), holdsClaim: true };

// witness: apps/server/src/zerops/crew/CrewPolicy.ts | if (claimCommand !== undefined && command === claimCommand) return allow; → if (ctx.holdsClaim && command === claimCommand) return allow;
it("CM48: Only a turn the crew shaped for a Show-on-dev claim moves the dev server, by its one command from the claimed copy, and the release turn gives the tree back; a dev server call or supervisor command in an ordinary turn is refused, as is one on another host, port or command", () => {
  const restart = {
    action: "restart",
    hostname: "appdev",
    port: 3000,
    processMatch: "npm run dev -- --host 0.0.0.0",
  };
  const fromCopy = { ...restart, workDir: "/var/www/.crew/backend" };
  const tool = "mcp__zerops__zerops_dev_server";
  const run = (command: string) => ({ command });
  const show = (cwd: string) =>
    `ssh appdev ${shellQuote(
      `zcp-devsup ctl --json stop web && zcp-devsup ctl --json run --name show-backend --cwd ${cwd} --port 3000 -- ${shellQuote(devServer.command)}`,
    )}`;
  const giveBack = `ssh appdev ${shellQuote("zcp-devsup ctl --json rm show-backend; zcp-devsup ctl --json start web")}`;
  expect(decision(shaped("claim-release"), "Bash", run(giveBack)).kind).toBe("allow");
  expect(decision(holder, "Bash", run(show(".crew/backend"))).kind).toBe("allow");
  expect(decision(holder, tool, fromCopy).kind).toBe("deny");
  expect(decision(writer, tool, restart).kind).toBe("deny");
  expect(decision(writer, "Bash", run(giveBack)).kind).toBe("deny");
  expect(decision(writer, tool, { action: "status", hostname: "appdev" }).kind).toBe("deny");
  expect(decision(holder, "Bash", run(show("."))).kind).toBe("deny");
  expect(decision(holder, "Bash", run(show(".crew/frontend"))).kind).toBe("deny");
  expect(decision(shaped("claim-release"), tool, { ...restart, port: undefined }).kind).toBe(
    "deny",
  );
  expect(decision(shaped("claim-release"), tool, { ...restart, port: 8080 }).kind).toBe("deny");
  expect(
    decision(shaped("claim-release"), tool, { ...restart, processMatch: undefined }).kind,
  ).toBe("deny");
  expect(decision(shaped("claim-release"), tool, { ...restart, processMatch: "npm" }).kind).toBe(
    "deny",
  );
  expect(
    decision(shaped("claim-release"), tool, { ...restart, command: "node server.js" }).kind,
  ).toBe("deny");
  expect(decision(shaped("claim-release"), tool, { ...restart, hostname: "apidev" }).kind).toBe(
    "deny",
  );
  expect(decision(shaped("claim-release"), tool, { ...restart, action: "stop" }).kind).toBe("deny");
  expect(decision(shaped("claim-release"), tool, { ...restart, logFile: "/tmp/x.log" }).kind).toBe(
    "deny",
  );
  expect(decision({ ...writer, turn: "claim-release" }, tool, restart).kind).toBe("deny");
  expect(
    decision({ ...reader, turn: "claim-start", devServer, holdsClaim: true }, tool, fromCopy).kind,
  ).toBe("deny");
});

// witness: apps/server/src/zerops/crew/CrewPolicy.ts | const underClaim = ctx.holdsClaim && ctx.member.lane !== undefined; → const underClaim = ctx.member.lane !== undefined;
it("CM49: A crewmate verifies its own host and opens the browser only while dev shows its work", () => {
  expect(decision(holder, "mcp__zerops__zerops_verify", { serviceHostname: "appdev" }).kind).toBe(
    "allow",
  );
  expect(decision(writer, "mcp__zerops__zerops_verify", { serviceHostname: "appdev" }).kind).toBe(
    "deny",
  );
  expect(decision(holder, "mcp__zerops__zerops_verify", { serviceHostname: "apidev" }).kind).toBe(
    "deny",
  );
  expect(decision(holder, "mcp__zerops__zerops_browser", { url: "https://appdev" }).kind).toBe(
    "allow",
  );
  expect(decision(writer, "mcp__zerops__zerops_browser", { url: "https://appdev" }).kind).toBe(
    "deny",
  );
});
