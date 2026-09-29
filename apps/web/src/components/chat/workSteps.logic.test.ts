import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import {
  commandShown,
  commandWhole,
  foldSteps,
  stepOf,
  trackCommands,
  unwrapShell,
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
