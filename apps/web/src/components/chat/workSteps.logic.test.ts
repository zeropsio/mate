import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import {
  backgroundJobOf,
  commandShown,
  commandWhole,
  foldSteps,
  stepOf,
  taskReportWords,
  trackCommands,
  unwrapShell,
  type TrackedCommands,
} from "./workSteps.logic";

function entry(partial: Partial<WorkLogEntry> & { id: string }): WorkLogEntry {
  return {
    createdAt: "2026-09-27T08:00:00.000Z",
    label: "Tool call",
    tone: "tool",
    sourceActivityKind: "tool.completed",
    toolLifecycleStatus: "completed",
    ...partial,
  };
}

function command(id: string, text: string, extra: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return entry({
    id,
    label: "Command run",
    itemType: "command_execution",
    command: text,
    toolCallId: `toolu_${id}`,
    startedAt: "2026-09-27T08:00:00.000Z",
    updatedAt: "2026-09-27T08:00:12.000Z",
    ...extra,
  });
}

function task(id: string, title: string, extra: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return entry({
    id,
    label: title,
    toolTitle: title,
    tone: "info",
    sourceActivityKind: "task.completed",
    taskId: `b${id}`,
    isBackgroundTask: true,
    createdAt: "2026-09-27T08:00:11.500Z",
    ...extra,
  } as Partial<WorkLogEntry> & { id: string });
}

// Codex runs every command through a login shell and says nothing of it
// (the owner saw "Ran a command" over `/usr/bin/zsh -lc "…"` on every one):
// the command a person reads is the one inside, as the shell got it.
describe("unwrapShell", () => {
  it.each([
    ['/usr/bin/zsh -lc "cd /var/www && ls -la"', "cd /var/www && ls -la"],
    ["/bin/bash -lc 'npm run build'", "npm run build"],
    ["bash -c 'pnpm test'", "pnpm test"],
    ["sh -c ls", "ls"],
    ["dash -c 'ls'", "ls"],
    ['bash -l -c "git status"', "git status"],
    ['/usr/bin/zsh -lc "echo \\"hi\\" > note.txt"', 'echo "hi" > note.txt'],
    ["bash -lc 'echo '\\''hi'\\'''", "echo 'hi'"],
    [
      "/usr/bin/zsh -lc \"cat > a.ts <<'EOF'\nexport {};\nEOF\"",
      "cat > a.ts <<'EOF'\nexport {};\nEOF",
    ],
    ["pnpm build", "pnpm build"],
    ["bash scripts/deploy.sh", "bash scripts/deploy.sh"],
    ["zsh -lc", "zsh -lc"],
    ['ssh appdev "bash -lc ls"', 'ssh appdev "bash -lc ls"'],
    // Only a command that is the shell's whole argument is taken out of it:
    // what follows the argument is the command too, and cutting it hid what
    // the command really did — a pipe, a fallback, a second command.
    [
      'bash -c "cd app && npm test" 2>&1 | tail -20',
      'bash -c "cd app && npm test" 2>&1 | tail -20',
    ],
    ["sh -c 'npm run build' || echo FAILED", "sh -c 'npm run build' || echo FAILED"],
    [
      "bash -c 'curl -s https://example.test/install' | sh",
      "bash -c 'curl -s https://example.test/install' | sh",
    ],
    ["sh -c npm test", "sh -c npm test"],
    ["bash -lc 'pnpm build'   ", "pnpm build"],
  ])("%j reads %j", (input, expected) => {
    expect(unwrapShell(input)).toBe(expected);
  });
});

describe("commandShown", () => {
  it.each([
    ["cd /var/www/app && npm run build", "npm run build"],
    ["cd '/var/www/my app' && ls -la", "ls -la"],
    ['cd /tmp; S=https://example.test; agent-browser open "$S/cz"', 'agent-browser open "$S/cz"'],
    ["cd /var/www/app && python3 - <<'EOF'\nprint(1)\nEOF", "python3 - <<'EOF'"],
    ["export CI=1 && pnpm test", "pnpm test"],
    ["NODE_ENV=production node server.js", "NODE_ENV=production node server.js"],
    ["  git   status  ", "git status"],
    ["cd app", "cd app"],
    [
      'ssh appdev "cd /var/www && npx tsc --noEmit"',
      'ssh appdev "cd /var/www && npx tsc --noEmit"',
    ],
    // The agent's own scratch folder is no place the person knows: its path goes.
    [
      "cat /tmp/claude-1000/-srv-app/0a1b2c3d-1111-4222-8333-444455556666/tasks/b7k.output",
      "cat …/tasks/b7k.output",
    ],
    [
      "tail -5 /private/tmp/claude-501/-Users-me-app/0a1b2c3d-1111-4222-8333-444455556666/scratchpad/log.txt",
      "tail -5 …/scratchpad/log.txt",
    ],
  ])("%j reads %j", (input, expected) => {
    expect(commandShown(input)).toBe(expected);
  });
});

describe("commandWhole", () => {
  it.each([
    ["cd /var/www/app && npm run build", "npm run build"],
    [
      "cd /var/www/app && python3 - <<'EOF'\nimport sys\nprint(1)\nEOF",
      "python3 - <<'EOF'\nimport sys\nprint(1)\nEOF",
    ],
    ["export CI=1 && pnpm test  \n", "pnpm test"],
    ["cd app", "cd app"],
    [
      "cat /tmp/claude-1000/-srv-app/0a1b2c3d-1111-4222-8333-444455556666/tasks/b7k.output\nwc -l /tmp/claude-1000/-srv-app/0a1b2c3d-1111-4222-8333-444455556666/tasks/b7k.output",
      "cat …/tasks/b7k.output\nwc -l …/tasks/b7k.output",
    ],
  ])("%j reads %j, every line of it", (input, expected) => {
    expect(commandWhole(input)).toBe(expected);
  });
});

describe("trackCommands", () => {
  it("links a task to the command it names, and marks it as no row of its own", () => {
    const run = command("1", "cd /tmp && ./capture.sh");
    const tracker = task("t1", "Screenshot the home page", { taskToolUseId: "toolu_1" });
    const tracked = trackCommands([run, tracker]);
    expect(tracked.byCommand.get("1")?.description).toBe("Screenshot the home page");
    expect([...tracked.trackers]).toEqual(["t1"]);
  });

  it("links a task that names no call to the command it ended with", () => {
    const tracked = trackCommands([
      command("1", "npm test"),
      task("t1", "Run the tests", { createdAt: "2026-09-27T08:00:13.000Z" }),
    ]);
    expect(tracked.byCommand.get("1")?.description).toBe("Run the tests");
  });

  // Grok names a background command's task by the command's first line, and
  // Antigravity by the command itself: no words of its own to lend.
  it.each([
    { name: "Grok's first line", command: "npm run dev\necho done", description: "npm run dev" },
    { name: "Antigravity's whole command", command: "npm run dev", description: "npm run dev" },
    { name: "a shell-wrapped one", command: "bash -lc 'npm run dev'", description: "npm run dev" },
    {
      name: "a long one Grok cut",
      command: `node ${"x".repeat(300)}`,
      description: `node ${"x".repeat(195)}`,
    },
  ])("lends no words from a task named by its command: $name", ({ command: text, description }) => {
    const run = command("1", text);
    const tracker = task("t1", description, { taskToolUseId: "toolu_1" });
    const tracked = trackCommands([run, tracker]);
    expect(tracked.byCommand.get("1")?.description).toBeUndefined();
    expect([...tracked.trackers]).toEqual(["t1"]);
    expect(stepOf(run, tracked).words).toBeNull();
  });

  // A long conversation holds many tasks and many commands: each task is read
  // against the commands' ends in order, never against every command.
  const ended = (second: number, extra: Partial<WorkLogEntry> = {}) => ({
    startedAt: "2026-09-27T08:00:00.000Z",
    updatedAt: new Date(Date.parse("2026-09-27T08:00:00.000Z") + second * 1000).toISOString(),
    ...extra,
  });
  const at = (second: number) =>
    new Date(Date.parse("2026-09-27T08:00:00.000Z") + second * 1000).toISOString();
  it.each([
    {
      name: "the first in the log wins, though a later one ended nearer",
      commands: [command("a", "one", ended(10)), command("b", "two", ended(12))],
      tasks: [task("t1", "Run", { createdAt: at(12) })],
      linked: [["a", "t1"]],
    },
    {
      name: "one already taken leaves the next",
      commands: [command("a", "one", ended(10)), command("b", "two", ended(11))],
      tasks: [
        task("t1", "Run", { createdAt: at(11) }),
        task("t2", "Run again", { createdAt: at(11) }),
      ],
      linked: [
        ["a", "t1"],
        ["b", "t2"],
      ],
    },
    {
      name: "one taken by name first is not taken again",
      commands: [command("a", "one", ended(10)), command("b", "two", ended(10))],
      tasks: [
        task("t1", "Named", { createdAt: at(10), taskToolUseId: "toolu_a" }),
        task("t2", "Unnamed", { createdAt: at(10) }),
      ],
      linked: [
        ["a", "t1"],
        ["b", "t2"],
      ],
    },
    {
      name: "the tolerance's edges, either side",
      commands: [command("a", "one", ended(7)), command("b", "two", ended(13))],
      tasks: [
        task("t1", "Early", { createdAt: at(10) }),
        task("t2", "Late", { createdAt: at(10) }),
      ],
      linked: [
        ["a", "t1"],
        ["b", "t2"],
      ],
    },
    {
      name: "past the tolerance, or started after the task, or with no time",
      commands: [
        command("a", "one", ended(6.999)),
        command("b", "two", ended(13.001)),
        command("c", "three", ended(10, { startedAt: at(10.5) })),
        command("d", "four", { startedAt: "never", updatedAt: "never" }),
      ],
      tasks: [task("t1", "Run", { createdAt: at(10) })],
      linked: [],
    },
  ])("links a task that names no call: $name", ({ commands, tasks, linked }) => {
    const tracked = trackCommands([...commands, ...tasks]);
    expect([...tracked.byCommand].map(([id, track]) => [id, track.task.id])).toEqual(linked);
  });

  it.each([
    {
      name: "a helper",
      extra: { taskType: "local_agent" } as Partial<WorkLogEntry>,
    },
    {
      name: "a task that ended long after the command",
      extra: { createdAt: "2026-09-27T08:05:00.000Z" } as Partial<WorkLogEntry>,
    },
    {
      name: "a task naming a call that is no command here",
      extra: { taskToolUseId: "toolu_elsewhere" } as Partial<WorkLogEntry>,
    },
  ])("leaves $name alone", ({ extra }) => {
    const tracked = trackCommands([command("1", "npm test"), task("t1", "Something", extra)]);
    expect(tracked.byCommand.size).toBe(0);
    expect(tracked.trackers.size).toBe(0);
  });
});

describe("stepOf", () => {
  it.each([
    {
      name: "a command with its own description",
      entry: command("1", "cd /var/www/app && npm test", {
        callInput: { description: "Run the tests" },
      }),
      words: "Run the tests",
      code: "npm test",
      kind: "command",
      phrase: null,
    },
    {
      name: "a command that said nothing of itself",
      entry: command("1", "cd /var/www/app && git status"),
      words: null,
      code: "git status",
      kind: "command",
      phrase: null,
    },
    {
      name: "a command Codex ran through its shell",
      entry: command("1", 'cd /var/www/app && echo \\"ready\\"', {
        rawCommand: '/usr/bin/zsh -lc "cd /var/www/app && echo \\"ready\\""',
      }),
      words: null,
      code: 'echo "ready"',
      kind: "command",
      phrase: null,
    },
    {
      name: "a look at a screenshot",
      entry: entry({ id: "1", itemType: "image_view", label: "Image view", detail: "/tmp/v1.png" }),
      words: "Looked at v1.png",
      code: null,
      kind: "look",
      phrase: { verb: "Looked at", targets: ["v1.png"], more: 0, code: true },
    },
    {
      name: "a read, by the file its detail names",
      entry: entry({ id: "1", detail: 'Read: {"file_path":"/var/www/app/src/page.tsx"}' }),
      words: "Read page.tsx",
      code: null,
      kind: "read",
      phrase: { verb: "Read", targets: ["page.tsx"], more: 0, code: true },
    },
    {
      name: "a written file",
      entry: entry({
        id: "1",
        itemType: "file_change",
        label: "File change",
        detail: 'Write: {"file_path":"/var/www/app/AGENTS.md","content":"…',
      }),
      words: "Wrote AGENTS.md",
      code: null,
      kind: "edit",
      phrase: { verb: "Wrote", targets: ["AGENTS.md"], more: 0, code: true },
    },
    {
      name: "edits to two files",
      entry: entry({
        id: "1",
        itemType: "file_change",
        changedFiles: ["/var/www/app/a.ts", "/var/www/app/b.ts"],
      }),
      words: "Edited a.ts and b.ts",
      code: null,
      kind: "edit",
      phrase: { verb: "Edited", targets: ["a.ts", "b.ts"], more: 0, code: true },
    },
    {
      name: "a code search",
      entry: entry({ id: "1", detail: 'Grep: {"pattern":"content-container"}' }),
      words: "Searched the code for content-container",
      code: null,
      kind: "search",
      phrase: {
        verb: "Searched the code for",
        targets: ["content-container"],
        more: 0,
        code: true,
      },
    },
    {
      // The folder it searches is no file it changed: "Editing src" said an
      // edit where the Mate only looked (the menu's live step, 2026-09-29).
      name: "a code search in a folder",
      entry: entry({
        id: "1",
        detail: 'Grep: {"pattern":"readinessCheck","path":"src"}',
        callInput: { pattern: "readinessCheck", path: "src" },
        changedFiles: ["src"],
      }),
      words: "Searched the code for readinessCheck",
      code: null,
      kind: "search",
      phrase: {
        verb: "Searched the code for",
        targets: ["readinessCheck"],
        more: 0,
        code: true,
      },
    },
    {
      name: "a page read on the web",
      entry: entry({
        id: "1",
        callInput: { url: "https://example.test/docs/zerops-yml" },
        itemType: "web_search",
        toolTitle: "WebFetch",
      }),
      words: "Read example.test/docs/zerops-yml",
      code: null,
      kind: "web",
      phrase: { verb: "Read", targets: ["example.test/docs/zerops-yml"], more: 0, code: true },
    },
    {
      name: "a Zerops tool no card shows",
      entry: entry({ id: "1", label: "zerops_workflow", itemType: "mcp_tool_call" }),
      words: "Checked the workflow",
      code: null,
      kind: "tool",
      phrase: { verb: "Checked the workflow", targets: [], more: 0, code: false },
    },
    {
      name: "a search of the web, its query in words",
      entry: entry({
        id: "1",
        callInput: { query: "zerops yaml build" },
        itemType: "web_search",
        toolTitle: "WebSearch",
      }),
      words: "Searched the web for zerops yaml build",
      code: null,
      kind: "web",
      phrase: {
        verb: "Searched the web for",
        targets: ["zerops yaml build"],
        more: 0,
        code: false,
      },
    },
  ])("says $name", ({ entry: call, words, code, kind, phrase }) => {
    const step = stepOf(call);
    expect({ words: step.words, code: step.code, kind: step.kind, phrase: step.phrase }).toEqual({
      words,
      code,
      kind,
      phrase,
    });
  });

  // A bubble draws a command whole, folded past its eighth line; its line of
  // words in the record kept only the first.
  it("keeps a command's whole script, its preamble dropped", () => {
    const step = stepOf(
      command("1", "cd /var/www/app && python3 - <<'EOF'\nimport sys\nprint(1)\nEOF"),
    );
    expect(step).toMatchObject({
      code: "python3 - <<'EOF'",
      script: "python3 - <<'EOF'\nimport sys\nprint(1)\nEOF",
      codeLines: 4,
    });
  });

  // The script is the command inside the shell, never the shell's call.
  it("keeps a shell-wrapped command's script without its shell", () => {
    const step = stepOf(
      command("1", "cd /var/www/app && python3 - <<'EOF'\nprint(1)\nEOF", {
        rawCommand: "/usr/bin/zsh -lc \"cd /var/www/app && python3 - <<'EOF'\nprint(1)\nEOF\"",
      }),
    );
    expect(step).toMatchObject({
      code: "python3 - <<'EOF'",
      script: "python3 - <<'EOF'\nprint(1)\nEOF",
      codeLines: 3,
    });
  });

  it("says a running call in its running words, and a live one runs", () => {
    const step = stepOf(
      entry({
        id: "1",
        detail: 'Read: {"file_path":"/var/www/app/src/page.tsx"}',
        toolLifecycleStatus: "inProgress",
      }),
    );
    expect(step).toMatchObject({ words: "Reading page.tsx", state: "running", endedAt: null });
  });

  it.each([
    { command: "cd /var/www/app && npm test", lines: 1 },
    { command: "cd /var/www/app && python3 - <<'EOF'\nimport sys\nprint(1)\nEOF", lines: 4 },
  ])("counts the lines of $command", ({ command: text, lines }) => {
    expect(stepOf(command("1", text)).codeLines).toBe(lines);
  });

  it("an unfinished call of a settled run is no longer running", () => {
    const step = stepOf(
      command("1", "npm test", { toolLifecycleStatus: "inProgress" }),
      undefined,
      false,
    );
    expect(step.state).toBe("done");
  });

  it("a failed command is failed", () => {
    expect(stepOf(command("1", "npm test", { toolLifecycleStatus: "failed" })).state).toBe(
      "failed",
    );
  });

  it("a tracked command takes its task's words, and ends when its task does", () => {
    const run = command("1", "cd /tmp && ./capture.sh");
    const tracker = task("t1", "Screenshot the home page", {
      taskToolUseId: "toolu_1",
      updatedAt: "2026-09-27T08:00:40.000Z",
    });
    const step = stepOf(run, trackCommands([run, tracker]));
    expect(step).toMatchObject({
      words: "Screenshot the home page",
      code: "./capture.sh",
      endedAt: "2026-09-27T08:00:40.000Z",
    });
  });

  it("a command whose task still runs is running, though its call returned", () => {
    const run = command("1", "npm run dev");
    const tracker = task("t1", "Start the dev server", {
      taskToolUseId: "toolu_1",
      sourceActivityKind: "task.progress",
      toolLifecycleStatus: "inProgress",
    });
    expect(stepOf(run, trackCommands([run, tracker])).state).toBe("running");
  });
});

/**
 * A command the Mate sent to the background: its call returned at once, and
 * the task it started reports in later — after the turn, often (run 9: a
 * four-minute soak, `npm outdated`, a job that fails after 20 s).
 */
describe("backgroundJobOf", () => {
  // The call returns as the job starts; the task runs on.
  const launch = command("1", "./soak.sh", {
    callInput: { description: "Run the soak test" },
    startedAt: "2026-09-27T08:00:00.000Z",
    updatedAt: "2026-09-27T08:00:01.000Z",
  });
  // As the server sends it: a task's start carries no lifecycle of a call.
  const started = task("t1", "Run the soak test", {
    taskToolUseId: "toolu_1",
    sourceActivityKind: "task.started",
    toolLifecycleStatus: undefined as never,
    createdAt: "2026-09-27T08:00:01.000Z",
  });
  const finished = (extra: Partial<WorkLogEntry>) =>
    task("t2", "Run the soak test", {
      taskToolUseId: "toolu_1",
      createdAt: "2026-09-27T08:04:01.000Z",
      ...extra,
    });

  it.each<{
    readonly name: string;
    readonly tasks: ReadonlyArray<WorkLogEntry>;
    readonly job: Record<string, unknown> | null;
    readonly step: Record<string, unknown>;
  }>([
    {
      name: "running on after the turn: no end, and no time but where it runs",
      tasks: [started],
      job: { title: "Run the soak test", state: "running", endedAt: null, report: null },
      step: { state: "done", endedAt: null },
    },
    {
      name: "finished: its whole span, nothing to report past its title",
      tasks: [
        started,
        finished({
          detail: 'Background command "Run the soak test" completed (exit code 0)',
        }),
      ],
      job: {
        state: "done",
        endedAt: "2026-09-27T08:04:01.000Z",
        report: null,
      },
      step: { state: "done", endedAt: "2026-09-27T08:04:01.000Z" },
    },
    {
      name: "failed: the step fails, and says how without its title again",
      tasks: [
        started,
        finished({
          tone: "error",
          toolLifecycleStatus: "failed",
          detail: 'Background command "Run the soak test" failed with exit code 3',
        }),
      ],
      job: { state: "failed", report: "Exit code 3" },
      step: { state: "failed" },
    },
  ])("$name", ({ tasks, job, step }) => {
    const tracked = trackCommands([launch, ...tasks]);
    const found = backgroundJobOf(launch, tracked);
    if (job === null) expect(found).toBeNull();
    else expect(found).toMatchObject(job);
    expect(stepOf(launch, tracked, false)).toMatchObject(step);
  });

  // A quick job (npm view, 2.5 s) ended within the tolerance of its call:
  // the call's own notice says it went to the background.
  it("is a job however quickly it ended, when its call said it went to the background", () => {
    const run = command("1", "npm view express version", {
      updatedAt: "2026-09-27T08:00:01.000Z",
      sentToBackground: "b1",
    });
    const tracker = task("t1", "Look up versions", {
      taskToolUseId: "toolu_1",
      createdAt: "2026-09-27T08:00:02.500Z",
    });
    expect(backgroundJobOf(run, trackCommands([run, tracker]))).toMatchObject({ state: "done" });
  });

  it("is no job when the command waited on its task: a long command Claude Code tracks", () => {
    const run = command("1", "npm test", { updatedAt: "2026-09-27T08:00:40.000Z" });
    const tracker = task("t1", "Run the tests", {
      taskToolUseId: "toolu_1",
      createdAt: "2026-09-27T08:00:40.000Z",
    });
    expect(backgroundJobOf(run, trackCommands([run, tracker]))).toBeNull();
  });

  // Its task reaches the log only once it ends: its call's word is enough.
  it("runs from the moment its call says it went to the background", () => {
    const run = command("1", "sleep 40; exit 2", {
      callInput: { description: "Sleep 40s then exit with code 2" },
      sentToBackground: "b94",
    });
    expect(backgroundJobOf(run, trackCommands([run]))).toMatchObject({
      title: "Sleep 40s then exit with code 2",
      state: "running",
      endedAt: null,
    });
  });

  // The session that ran it is gone (a restart, the session ended): nothing
  // will report, and "running in the background" would stand forever.
  it.each([
    { name: "the server holds it no longer", held: [], live: false, state: "lost" },
    { name: "the server holds it", held: ["b94"], live: false, state: "running" },
    { name: "only a newer session's job lives", held: ["b7"], live: false, state: "lost" },
    { name: "its own turn still runs", held: [], live: true, state: "running" },
  ])("a job that never reported: $name", ({ held, live, state }) => {
    const run = command("1", "sleep 40; exit 2", { sentToBackground: "b94" });
    const tracked: TrackedCommands = { ...trackCommands([run]), liveJobs: { ids: new Set(held) } };
    expect(backgroundJobOf(run, tracked, live)?.state).toBe(state);
  });

  it("is no job while its call has not returned", () => {
    const run = command("1", "./soak.sh", { toolLifecycleStatus: "inProgress" });
    expect(backgroundJobOf(run, trackCommands([run, started]))).toBeNull();
  });

  it("opens onto what it reported, never the notice that it went to the background", () => {
    const run = command("1", "./soak.sh", {
      callInput: { description: "Run the soak test" },
      updatedAt: "2026-09-27T08:00:01.000Z",
      sentToBackground: "b1",
      detail: "Command running in background with ID: b1. Output is being written to: /tmp/x",
    });
    const failed = finished({
      tone: "error",
      toolLifecycleStatus: "failed",
      detail: 'Background command "Run the soak test" failed with exit code 3',
    });
    expect(stepOf(run, trackCommands([run, started, failed]), false).background).toMatchObject({
      report: "Exit code 3",
    });
  });
});

// Run on Dara: the live card said "Read be98ni9xv.output" — Claude Code reading
// the file a background job writes. It names the job.
describe("a read of a background job's output", () => {
  const read = (path: string, extra: Partial<WorkLogEntry> = {}) =>
    entry({
      id: "r1",
      label: "Read",
      itemType: "dynamic_tool_call",
      toolName: "Read",
      callInput: { filePath: path },
      ...extra,
    } as Partial<WorkLogEntry> & { id: string });
  const job = task("t1", "Sleep 60s then print soak ok", { taskId: "be98ni9xv" });

  it.each([
    {
      name: "a job it knows: by the job's words",
      path: "/tmp/claude-1000/-srv/0a1b2c3d-1111-4222-8333-444455556666/tasks/be98ni9xv.output",
      words: "Read the output of Sleep 60s then print soak ok",
    },
    {
      name: "a job it does not know: as a job's output",
      path: "/tmp/claude-1000/-srv/0a1b2c3d-1111-4222-8333-444455556666/tasks/zz9.output",
      words: "Read a background job's output",
    },
    { name: "any other file: by its name", path: "/srv/app/notes.txt", words: "Read notes.txt" },
  ])("$name", ({ path, words }) => {
    const reading = read(path);
    expect(stepOf(reading, trackCommands([reading, job]), false).words).toBe(words);
  });

  // Review of pass 39: a running job's task is not in the log until it ends;
  // the command that sent it away names it.
  it("names a job still running by the command that sent it away", () => {
    const sent = command("9", "sleep 60", {
      callInput: { description: "Sleep a minute" },
      sentToBackground: "zz9",
    });
    const reading = read(
      "/tmp/claude-1000/-srv/0a1b2c3d-1111-4222-8333-444455556666/tasks/zz9.output",
    );
    expect(stepOf(reading, trackCommands([sent, reading]), false).words).toBe(
      "Read the output of Sleep a minute",
    );
  });
});

// Run 11: the working line read "Reading br89ocvyk.txt" — the agent reading a
// command's output Claude Code had saved to a file. It names what made it.
describe("a read of a call's spilled output", () => {
  const RESULTS =
    "/home/zerops/.claude/projects/-srv-app/0a1b2c3d-1111-4222-8333-444455556666/tool-results";
  const read = (path: string) =>
    entry({
      id: "r1",
      label: "Read",
      itemType: "dynamic_tool_call",
      toolName: "Read",
      toolLifecycleStatus: "inProgress",
      callInput: { filePath: path },
    } as Partial<WorkLogEntry> & { id: string });
  const described = command("c1", "curl -s localhost:3000/catalogue", {
    callInput: { description: "List the catalogue" },
    spilledTo: "q7t2m4xke",
  });
  const plain = command("c2", "pnpm build", { spilledTo: "w3h8d1rza" });

  it.each([
    {
      name: "a command it knows, described: by its words",
      path: `${RESULTS}/q7t2m4xke.txt`,
      words: "Reading the output of List the catalogue",
    },
    {
      name: "a command it knows: by the command",
      path: `${RESULTS}/w3h8d1rza.txt`,
      words: "Reading the output of pnpm build",
    },
    {
      name: "one it does not know: as a command's output",
      path: `${RESULTS}/zz8k2m1pq.txt`,
      words: "Reading a command's output",
    },
    {
      name: "an MCP tool's: by the tool its name holds",
      path: `${RESULTS}/mcp-zerops-zerops_logs-1759650000000.txt`,
      words: "Reading the output of zerops logs",
    },
    {
      name: "a file of the same name elsewhere: by its name",
      path: "/srv/app/q7t2m4xke.txt",
      words: "Reading q7t2m4xke.txt",
    },
    // Review of pass 42: a project's own folder of that name is no session's.
    {
      name: "a project's own tool-results folder: by its name",
      path: "/srv/app/api/tool-results/q7t2m4xke.txt",
      words: "Reading q7t2m4xke.txt",
    },
  ])("$name", ({ path, words }) => {
    const reading = read(path);
    expect(stepOf(reading, trackCommands([described, plain, reading])).words).toBe(words);
  });

  it("says it plainly with nothing to name it by, as the menu's live step does", () => {
    expect(stepOf(read(`${RESULTS}/q7t2m4xke.txt`)).words).toBe("Reading a command's output");
  });
});

describe("taskReportWords", () => {
  it.each([
    ['Background command "Soak" failed with exit code 3', "Exit code 3"],
    ['Background command "Soak" completed (exit code 0)', null],
    ['Background command "Soak" was stopped', "Stopped"],
    ["Soak failed with exit code 144", "Exit code 144"],
    ["Found 3 broken links on /about", "Found 3 broken links on /about"],
    ["", null],
  ])("%j adds %j to its line", (detail, expected) => {
    expect(taskReportWords(detail, "Soak")).toBe(expected);
  });
});

/**
 * Every driver's calls, as the server hands them over (`projectActivityPayload`):
 * the tool's name at `toolName` — Claude's own, OpenCode's (`read`, `grep`,
 * `webfetch`, ...), an ACP agent's kind (`read`, `search`, `fetch`, ...) —
 * and what it names in Claude's keys. Each reads as Claude's would.
 */
describe("stepOf — every driver", () => {
  const done = (partial: Partial<WorkLogEntry>) =>
    stepOf(entry({ id: "1", toolCallId: "call-1", ...partial }), undefined, false);

  it.each<{
    readonly name: string;
    readonly partial: Partial<WorkLogEntry>;
    readonly kind: string;
    readonly words: string;
  }>([
    {
      name: "an ACP read",
      partial: {
        label: "Read file",
        itemType: "dynamic_tool_call",
        toolName: "read",
        detail: "/app/src/app.ts",
        callInput: { filePath: "/app/src/app.ts" },
        changedFiles: ["/app/src/app.ts"],
      },
      kind: "read",
      words: "Read app.ts",
    },
    {
      name: "an ACP grep, which comes typed as a web search",
      partial: {
        label: "Searched files",
        itemType: "web_search",
        toolName: "search",
        callInput: { pattern: "TODO" },
      },
      kind: "search",
      words: "Searched the code for TODO",
    },
    {
      name: "an ACP fetch",
      partial: {
        label: "Searched files",
        itemType: "web_search",
        toolName: "fetch",
        callInput: { url: "https://example.com/docs" },
      },
      kind: "web",
      words: "Read example.com/docs",
    },
    {
      name: "an ACP edit",
      partial: {
        label: "Changed files",
        itemType: "file_change",
        toolName: "edit",
        changedFiles: ["/app/src/app.ts"],
      },
      kind: "edit",
      words: "Edited app.ts",
    },
    {
      name: "an OpenCode read",
      partial: {
        label: "src/app.ts",
        itemType: "dynamic_tool_call",
        toolName: "read",
        detail: "<file>\n00001| export {}\n</file>",
        callInput: { filePath: "/app/src/app.ts" },
      },
      kind: "read",
      words: "Read app.ts",
    },
    {
      name: "an OpenCode grep",
      partial: {
        label: "TODO",
        itemType: "dynamic_tool_call",
        toolName: "grep",
        callInput: { pattern: "TODO", path: "src" },
        changedFiles: ["src"],
      },
      kind: "search",
      words: "Searched the code for TODO",
    },
    {
      name: "an OpenCode glob",
      partial: {
        label: "src",
        itemType: "dynamic_tool_call",
        toolName: "glob",
        callInput: { pattern: "**/*.ts" },
      },
      kind: "search",
      words: "Looked for **/*.ts",
    },
    {
      name: "an OpenCode list",
      partial: { label: "src", itemType: "dynamic_tool_call", toolName: "list" },
      kind: "search",
      words: "Looked for files",
    },
    {
      name: "an OpenCode webfetch",
      partial: {
        label: "https://example.com",
        itemType: "web_search",
        toolName: "webfetch",
        callInput: { url: "https://example.com/" },
      },
      kind: "web",
      words: "Read example.com",
    },
    {
      name: "an OpenCode todo list",
      partial: { label: "3 todos", itemType: "dynamic_tool_call", toolName: "todowrite" },
      kind: "tool",
      words: "Updated its list",
    },
    {
      name: "an OpenCode helper",
      partial: { label: "Explore", itemType: "collab_agent_tool_call", toolName: "task" },
      kind: "tool",
      words: "Started a helper",
    },
    {
      name: "an OpenCode skill, by the skill it loads",
      partial: {
        label: "skill",
        itemType: "dynamic_tool_call",
        toolName: "skill",
        callInput: { skill: "zerops-deploy" },
      },
      kind: "tool",
      words: "Used the zerops-deploy skill",
    },
    {
      name: "a Zerops tool with no card, from any driver",
      partial: {
        label: "Running zerops_knowledge",
        itemType: "dynamic_tool_call",
        toolName: "zerops_knowledge",
      },
      kind: "tool",
      words: "Read the Zerops guides",
    },
    {
      name: "another MCP tool, by its name",
      partial: {
        label: "Running create_issue",
        itemType: "dynamic_tool_call",
        toolName: "create_issue",
      },
      kind: "tool",
      words: "Used create issue",
    },
    {
      name: "an MCP tool named as a native one",
      partial: { label: "db_execute", itemType: "dynamic_tool_call", toolName: "mcp__db__execute" },
      kind: "tool",
      words: "Used execute",
    },
    {
      name: "OpenCode's own underscored tool",
      partial: { label: "plan_exit", itemType: "dynamic_tool_call", toolName: "plan_exit" },
      kind: "tool",
      words: "Used plan exit",
    },
    {
      name: "an ACP search of the web",
      partial: {
        label: "Searched files",
        itemType: "web_search",
        toolName: "websearch",
        callInput: { query: "zerops yaml" },
      },
      kind: "web",
      words: "Searched the web for zerops yaml",
    },
    {
      name: "a Zerops tool by its MCP name",
      partial: {
        label: "Running zerops_knowledge",
        itemType: "dynamic_tool_call",
        toolName: "mcp__zerops__zerops_knowledge",
      },
      kind: "tool",
      words: "Read the Zerops guides",
    },
    {
      name: "a Grok tool its title names",
      partial: { label: "enter_plan_mode", itemType: "dynamic_tool_call" },
      kind: "tool",
      words: "Used enter plan mode",
    },
  ])("$name reads $words", ({ partial, kind, words }) => {
    const step = done(partial);
    expect({ kind: step.kind, words: step.words }).toEqual({ kind, words });
  });

  it("folds an ACP agent's edits of one file into one step of one file", () => {
    const edit = (id: string) =>
      entry({
        id,
        toolCallId: `call-${id}`,
        label: "Changed files",
        itemType: "file_change",
        toolName: "edit",
        changedFiles: ["/app/src/app.ts"],
      });
    const steps = foldSteps(["1", "2", "3", "4", "5"].map(edit), undefined, false);
    expect(steps.map((step) => step.words)).toEqual(["Edited app.ts"]);
  });
});

describe("foldSteps", () => {
  const look = (id: string, path: string) =>
    entry({ id, itemType: "image_view", label: "Image view", detail: path });

  it("folds looks in a row into one step naming them", () => {
    const steps = foldSteps([
      command("1", "./capture.sh"),
      look("2", "/tmp/home.png"),
      look("3", "/tmp/cart.png"),
      look("4", "/tmp/checkout.png"),
      command("5", "git status"),
    ]);
    expect(steps.map((step) => [step.kind, step.words ?? step.code])).toEqual([
      ["command", "./capture.sh"],
      ["look", "Looked at home.png, cart.png and checkout.png"],
      ["command", "git status"],
    ]);
    expect(steps[1]?.images).toEqual(["/tmp/home.png", "/tmp/cart.png", "/tmp/checkout.png"]);
    expect(steps[1]?.key).toBe("2");
    expect(steps[1]?.phrase).toEqual({
      verb: "Looked at",
      targets: ["home.png", "cart.png", "checkout.png"],
      more: 0,
      code: true,
    });
  });

  it("folds edits in a row into one step naming each file once", () => {
    const edit = (id: string, file: string, tool = "Edit") =>
      entry({
        id,
        itemType: "file_change",
        label: "File change",
        detail: `${tool}: {"file_path":"/var/www/app/${file}"}`,
      });
    const steps = foldSteps([
      edit("1", "index.ts"),
      edit("2", "index.ts"),
      edit("3", "index.ts"),
      command("4", "npm test"),
      edit("5", "a.ts"),
      edit("6", "b.ts", "Write"),
    ]);
    expect(steps.map((step) => [step.words ?? step.code, step.entries.length])).toEqual([
      ["Edited index.ts", 3],
      ["npm test", 1],
      ["Edited a.ts and b.ts", 2],
    ]);
    expect(steps[2]?.phrase).toEqual({
      verb: "Edited",
      targets: ["a.ts", "b.ts"],
      more: 0,
      code: true,
    });
  });

  // A call still running is the live slot's: folded into the step before
  // it, the step's row left the history while it ran (pass 35).
  it.each([
    {
      name: "an edit",
      make: (id: string, running: boolean) =>
        entry({
          id,
          itemType: "file_change",
          label: "File change",
          detail: `Edit: {"file_path":"/var/www/app/${id}.ts"}`,
          ...(running ? { toolLifecycleStatus: "inProgress" as const } : {}),
        }),
    },
    {
      name: "a look",
      make: (id: string, running: boolean) =>
        entry({
          id,
          itemType: "image_view",
          label: "Image view",
          detail: `/tmp/${id}.png`,
          ...(running ? { toolLifecycleStatus: "inProgress" as const } : {}),
        }),
    },
  ])("never folds $name still running into the step before it", ({ make }) => {
    const steps = foldSteps([make("e1", false), make("e2", true)]);
    expect(steps.map((step) => step.key)).toEqual(["e1", "e2"]);
    // Settled, it never returned: "No result" on a line of its own (D5),
    // and nothing that came after folds into it.
    for (const order of [
      [make("e1", false), make("e2", true)],
      [make("e1", true), make("e2", false)],
    ]) {
      const settled = foldSteps(order, undefined, false);
      expect(settled.map((step) => step.key)).toEqual(["e1", "e2"]);
    }
  });

  it("counts past three pictures", () => {
    const steps = foldSteps(
      ["a", "b", "c", "d", "e"].map((name, index) => look(`${index}`, `/tmp/${name}.png`)),
    );
    expect(steps.map((step) => step.words)).toEqual(["Looked at a.png, b.png and 3 more"]);
    expect(steps[0]?.phrase).toEqual({
      verb: "Looked at",
      targets: ["a.png", "b.png"],
      more: 3,
      code: true,
    });
  });
});
