import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import { commandShown, foldSteps, stepOf, trackCommands } from "./workSteps.logic";

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
  ])("%j reads %j", (input, expected) => {
    expect(commandShown(input)).toBe(expected);
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
    },
    {
      name: "a command that said nothing of itself",
      entry: command("1", "cd /var/www/app && git status"),
      words: null,
      code: "git status",
      kind: "command",
    },
    {
      name: "a look at a screenshot",
      entry: entry({ id: "1", itemType: "image_view", label: "Image view", detail: "/tmp/v1.png" }),
      words: "Looked at v1.png",
      code: null,
      kind: "look",
    },
    {
      name: "a read, by the file its detail names",
      entry: entry({ id: "1", detail: 'Read: {"file_path":"/var/www/app/src/page.tsx"}' }),
      words: "Read page.tsx",
      code: null,
      kind: "read",
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
    },
    {
      name: "a code search",
      entry: entry({ id: "1", detail: 'Grep: {"pattern":"content-container"}' }),
      words: "Searched the code for content-container",
      code: null,
      kind: "search",
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
    },
    {
      name: "a Zerops tool no card shows",
      entry: entry({ id: "1", label: "zerops_workflow", itemType: "mcp_tool_call" }),
      words: "Checked the workflow",
      code: null,
      kind: "tool",
    },
  ])("says $name", ({ entry: call, words, code, kind }) => {
    const step = stepOf(call);
    expect({ words: step.words, code: step.code, kind: step.kind }).toEqual({ words, code, kind });
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
  });

  it("counts past three pictures", () => {
    const steps = foldSteps(
      ["a", "b", "c", "d", "e"].map((name, index) => look(`${index}`, `/tmp/${name}.png`)),
    );
    expect(steps.map((step) => step.words)).toEqual(["Looked at a.png, b.png and 3 more"]);
  });
});
