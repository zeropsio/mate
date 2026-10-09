import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveWorkLogEntries } from "./session-logic";

function makeCommandActivity(
  id: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    createdAt: "2026-07-17T10:00:00.000Z",
    kind: "tool.completed",
    summary: "Ran command",
    tone: "tool",
    payload,
    turnId: TurnId.make("turn-1"),
  };
}

describe("deriveWorkLogEntries command output", () => {
  it("uses Codex aggregated output instead of repeating the command", () => {
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("codex-command", {
        itemType: "command_execution",
        title: "Ran command",
        detail: "/bin/zsh -lc \"printf 'hello\\n'\"",
        data: {
          item: {
            type: "commandExecution",
            command: "/bin/zsh -lc \"printf 'hello\\n'\"",
            commandActions: [{ command: "printf 'hello\\n'", type: "unknown" }],
            aggregatedOutput: "hello\n<exited with exit code 0>",
            status: "completed",
          },
        },
      }),
    ]);

    expect(entry).toMatchObject({
      command: "printf 'hello\\n'",
      rawCommand: "/bin/zsh -lc \"printf 'hello\\n'\"",
      detail: "hello",
    });
  });

  it("uses a projected Claude output summary instead of repeating the command", () => {
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("claude-command", {
        itemType: "command_execution",
        title: "Ran command",
        detail: "printf hello",
        data: {
          kind: "execute",
          command: "printf hello",
          rawOutput: {
            content: "hello from claude",
          },
        },
      }),
    ]);

    expect(entry).toMatchObject({
      command: "printf hello",
      detail: "hello from claude",
    });
  });

  it("keeps command output that equals the command text", () => {
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("matching-output", {
        itemType: "command_execution",
        title: "Ran command",
        detail: "printf hello",
        data: {
          command: "printf hello",
          rawOutput: { content: "printf hello" },
        },
      }),
    ]);

    expect(entry).toMatchObject({
      command: "printf hello",
      detail: "printf hello",
    });
  });

  it("keeps OpenCode detail-only output when it equals the command", () => {
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("opencode-detail-output", {
        itemType: "command_execution",
        title: "bash",
        detail: "printf hello",
        data: { command: "printf hello" },
      }),
    ]);

    expect(entry).toMatchObject({
      command: "printf hello",
      detail: "printf hello",
    });
  });

  it("drops a Claude tool-name detail when there is no output", () => {
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("claude-no-output", {
        itemType: "command_execution",
        title: "Command run",
        detail: "Bash: printf hello",
        data: {
          toolName: "Bash",
          command: "printf hello",
        },
      }),
    ]);

    expect(entry?.command).toBe("printf hello");
    expect(entry?.detail).toBeUndefined();
  });

  it("drops a truncated Claude tool-name detail for a long command", () => {
    const command = `git add -A && git commit -m "${"x".repeat(200)}"`;
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("claude-long-command", {
        itemType: "command_execution",
        title: "Command run",
        detail: `Bash: ${command}`.slice(0, 177) + "...",
        data: {
          toolName: "Bash",
          command,
        },
      }),
    ]);

    expect(entry?.command).toBe(command);
    expect(entry?.detail).toBeUndefined();
  });

  it("drops an ACP command echo when the update omits the tool kind", () => {
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("acp-no-kind", {
        itemType: "command_execution",
        title: "Terminal",
        detail: "pnpm test",
        data: {
          toolCallId: "tool-1",
          command: "pnpm test",
        },
      }),
    ]);

    expect(entry?.command).toBe("pnpm test");
    expect(entry?.detail).toBeUndefined();
  });

  it("drops duplicated command detail when the command has no output", () => {
    const [entry] = deriveWorkLogEntries([
      makeCommandActivity("empty-command", {
        itemType: "command_execution",
        title: "Ran command",
        detail: "true",
        data: {
          kind: "execute",
          command: "true",
        },
      }),
    ]);

    expect(entry?.command).toBe("true");
    expect(entry?.detail).toBeUndefined();
  });
});

describe("web activity normalization", () => {
  function readActivity(payload: Record<string, unknown> | null) {
    return deriveWorkLogEntries([
      {
        ...makeCommandActivity("normalized", {}),
        kind: "tool.updated",
        payload,
      },
    ])[0];
  }

  // Compatibility controls use surface records and literal expectations, not the shared parser.
  it.each([
    {
      title: "prefers the item's command to other command evidence",
      data: {
        item: {
          command: "printf item",
          input: { command: "printf input" },
          result: { command: "printf result" },
        },
        command: "printf data",
      },
      command: "printf item",
    },
    {
      title: "reads command input when the item's command is malformed",
      data: { item: { command: 12, input: { command: "printf input" } } },
      command: "printf input",
    },
    {
      title: "reads a command from the tool result",
      data: { item: { result: { command: "printf result" } } },
      command: "printf result",
    },
    {
      title: "unwraps a supported shell command array",
      data: { command: ["/bin/zsh", "-lc", "printf hello"] },
      command: "printf hello",
      rawCommand: '/bin/zsh -lc "printf hello"',
    },
    {
      title: "unwraps a quoted PowerShell executable",
      data: { command: '"C:\\Program Files\\PowerShell\\pwsh.exe" -Command "Get-Date"' },
      command: "Get-Date",
      rawCommand: '"C:\\Program Files\\PowerShell\\pwsh.exe" -Command "Get-Date"',
    },
    {
      title: "unwraps a Windows command shell",
      data: { command: 'cmd.exe /c "echo hello"' },
      command: "echo hello",
      rawCommand: 'cmd.exe /c "echo hello"',
    },
    {
      title: "keeps unknown command wrappers intact",
      data: { command: "custom -c hello" },
      command: "custom -c hello",
    },
    {
      title: "does not invent a command from malformed evidence",
      data: { command: [null, 42, " "] },
      command: undefined,
    },
  ])("$title", ({ data, command, rawCommand }) => {
    const entry = readActivity({ itemType: "command_execution", data });
    expect(entry?.command).toBe(command);
    expect(entry?.rawCommand).toBe(rawCommand);
  });

  it("preserves unmatched shell quotes in the visible command", () => {
    const entry = readActivity({
      itemType: "command_execution",
      data: { command: "/bin/zsh -lc 'printf hello" },
    });
    expect(entry?.command).toBe("/bin/zsh -lc 'printf hello");
    expect(entry?.rawCommand).toBeUndefined();
  });

  it("reads a detail command without its trailing exit code", () => {
    expect(
      readActivity({
        itemType: "command_execution",
        detail: "printf hello <exited with exit code 0>",
      })?.command,
    ).toBe("printf hello");
    expect(
      readActivity({ itemType: "file_change", detail: "printf hello" })?.command,
    ).toBeUndefined();
  });

  it.each([
    ["inProgress", "inProgress"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["declined", "declined"],
    ["stopped", "stopped"],
    ["pending", "inProgress"],
    ["running", "inProgress"],
    ["waiting", "inProgress"],
    ["cancelled", "stopped"],
    ["interrupted", "stopped"],
    ["lost", "stopped"],
    ["idle", undefined],
    ["unknown", undefined],
    [12, undefined],
    [null, undefined],
  ])("normalizes lifecycle evidence %s to %s", (status, expected) => {
    expect(readActivity({ itemType: "command_execution", status })?.toolLifecycleStatus).toBe(
      expected,
    );
  });

  it("shows inactive subagent batch tracking as stopped", () => {
    expect(readActivity({ taskType: "subagent_batch", status: "idle" })?.toolLifecycleStatus).toBe(
      "stopped",
    );
  });

  it("extracts ordered unique changed paths from nested evidence", () => {
    expect(
      readActivity({
        itemType: "file_change",
        data: {
          path: " src/one.ts ",
          filePath: "src/one.ts",
          relativePath: "src/two.ts",
          item: {
            result: {
              changes: [
                { filename: "src/three.ts", newPath: "src/new.ts", oldPath: "src/old.ts" },
                { path: 42, filePath: " " },
              ],
            },
          },
          operations: [{ edits: [{ path: "src/four.ts" }] }],
        },
      })?.changedFiles,
    ).toEqual([
      "src/one.ts",
      "src/two.ts",
      "src/three.ts",
      "src/new.ts",
      "src/old.ts",
      "src/four.ts",
    ]);
  });

  it("bounds changed-file evidence by depth and file count", () => {
    const entry = readActivity({
      itemType: "file_change",
      data: {
        item: { result: { input: { data: { item: { path: "too-deep.ts" } } } } },
        files: Array.from({ length: 14 }, (_, index) => ({ path: `file-${index}.ts` })),
      },
    });
    expect(entry?.changedFiles).toEqual([
      "file-0.ts",
      "file-1.ts",
      "file-2.ts",
      "file-3.ts",
      "file-4.ts",
      "file-5.ts",
      "file-6.ts",
      "file-7.ts",
      "file-8.ts",
      "file-9.ts",
      "file-10.ts",
      "file-11.ts",
    ]);
  });

  it.each([
    null,
    {},
    { data: "bad", status: {} },
    { data: { files: [null, "path.ts", { path: false }] } },
  ])("leaves missing or malformed activity evidence absent: %j", (payload) => {
    const entry = readActivity(payload);
    expect(entry).toBeDefined();
    expect(entry?.command).toBeUndefined();
    expect(entry?.rawCommand).toBeUndefined();
    expect(entry?.changedFiles).toBeUndefined();
    expect(entry?.toolLifecycleStatus).toBeUndefined();
  });
});
