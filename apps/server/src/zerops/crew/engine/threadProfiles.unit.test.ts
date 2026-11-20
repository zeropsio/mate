import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  type ModelSelection,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import { decideAcpPermission } from "../../../spi/acpThreadProfile.ts";
import {
  type CodexFileChange,
  codexProfileModelSelection,
  codexThreadSetup,
  codexThreadStart,
} from "../../../spi/codexThreadProfile.ts";
import {
  decideOpenCodePermission,
  type OpenCodePermissionAsk,
  type OpenCodeToolInput,
} from "../../../spi/openCodeThreadProfile.ts";
import {
  makeInstallSlot,
  profileModelSelection,
  profiledRuntimeMode,
  type ThreadToolPolicy,
  ThreadToolPolicyRegistry,
  type ThreadToolProfile,
  type ToolDecision,
} from "../../../spi/threadToolPolicy.ts";

const CWD = "/var/www/.crew/backend";

type ToolCall = Parameters<ThreadToolProfile["decideTool"]>[0];

const PROFILE: ThreadToolProfile = {
  sessionContext: "You are @backend on the crew.",
  contextWindow: 200_000,
  decideTool: () => Effect.succeed({ kind: "allow" }),
  tools: [],
};

/** A profile whose gate records every call and answers with `decide`. */
const recording = (decide: ThreadToolProfile["decideTool"]) => {
  const calls: Array<ToolCall> = [];
  const profile: ThreadToolProfile = {
    ...PROFILE,
    decideTool: (call) => Effect.suspend(() => (calls.push(call), decide(call))),
  };
  return { calls, profile };
};

/** The gate a crew lane's ACP crewmate meets: its own files, a plain test run, the crew tools. */
const acpGate = (call: { readonly toolName: string; readonly input: unknown }): ToolDecision => {
  const input = call.input as Record<string, unknown>;
  if (call.toolName.startsWith("mcp__crew__")) return { kind: "allow" };
  if (call.toolName === "mcp__zerops__zerops_deploy") return { kind: "deny", reason: "no" };
  if (call.toolName === "Bash") {
    if (input.command === "npm test") return { kind: "allow" };
    if (input.command === "npm run dev") {
      return { kind: "allow", updatedInput: { command: "ssh appdev 'npm run dev'" } };
    }
    return { kind: "deny", reason: "no" };
  }
  if (call.toolName === "Edit" || call.toolName === "Read") {
    return String(input.file_path).startsWith(CWD)
      ? { kind: "allow" }
      : { kind: "deny", reason: "no" };
  }
  return { kind: "deny", reason: "no" };
};

const acpProfile: ThreadToolProfile = {
  sessionContext: "",
  contextWindow: 1,
  decideTool: (call) => Effect.sync(() => acpGate(call)),
  tools: [],
};

type AcpCall = Omit<EffectAcpSchema.RequestPermissionRequest["toolCall"], "toolCallId">;

const OPTIONS: EffectAcpSchema.RequestPermissionRequest["options"] = [
  { optionId: "always", kind: "allow_always", name: "Always" },
  { optionId: "once", kind: "allow_once", name: "Once" },
  { optionId: "no", kind: "reject_once", name: "No" },
];

const acpRequest = (
  toolCall: AcpCall,
  options = OPTIONS,
): EffectAcpSchema.RequestPermissionRequest => ({
  sessionId: "s",
  options,
  toolCall: { toolCallId: "call-1", ...toolCall },
});

/** The option an ACP crewmate's request is answered with, or that it was cancelled. */
const acpAnswer = (profile: ThreadToolProfile, call: AcpCall, options = OPTIONS) =>
  Effect.map(decideAcpPermission(profile, acpRequest(call, options), CWD), ({ outcome }) =>
    outcome.outcome === "selected" ? outcome.optionId : "cancelled",
  );

// witness: apps/server/src/spi/acpThreadProfile.ts | ? request.options.find((candidate) => candidate.kind === "allow_once") → ? request.options.find((candidate) => candidate.kind === "allow_always")
it.effect(
  "CD39: A crewmate's ACP permission request is answered by its one-time allow only when every call it names passes the crew's gate unchanged, else by its one-time rejection, and never by an always option: a request offering only that is cancelled",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<readonly [AcpCall, string]> = [
        [{ kind: "execute", rawInput: { command: "npm test" } }, "once"],
        [{ kind: "execute", rawInput: { command: "npm run dev" } }, "no"],
        [{ kind: "execute", rawInput: { command: "rm -rf /" } }, "no"],
        [{ kind: "think" }, "once"],
      ];
      for (const [call, expected] of rows) {
        expect(yield* acpAnswer(acpProfile, call)).toBe(expected);
      }
      const npmTest: AcpCall = { kind: "execute", rawInput: { command: "npm test" } };
      expect(yield* acpAnswer(acpProfile, npmTest, [OPTIONS[0]!])).toBe("cancelled");
      const failing = { ...acpProfile, decideTool: () => Effect.die("gate down") };
      expect(yield* acpAnswer(failing, npmTest)).toBe("no");
    }),
);

// witness: apps/server/src/spi/acpThreadProfile.ts | if (segment === "..") segments.pop(); → if (segment === "..") continue;
it.effect(
  "CD40: An ACP call is judged where it acts: a relative path or file URI resolves in the crewmate's directory with `..` resolved, so an edit that climbs out, a command run in another directory, a move to a file outside the lane and a request naming nothing are declined",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<readonly [AcpCall, string]> = [
        [{ kind: "edit", locations: [{ path: "src/a.ts" }] }, "once"],
        [{ kind: "edit", locations: [{ path: `file://${CWD}/src/a.ts` }] }, "once"],
        [{ kind: "move", rawInput: { from: "src/a.ts", to: "src/b.ts" } }, "once"],
        [{ kind: "edit", locations: [{ path: "../../../etc/passwd" }] }, "no"],
        [{ kind: "execute", rawInput: { CommandLine: "npm test", Cwd: "/etc" } }, "no"],
        [{ kind: "execute", rawInput: { command: "npm test", workdir: "/etc" } }, "no"],
        [{ kind: "move", rawInput: { source: "src/a.ts", destination: "/etc/a.ts" } }, "no"],
        [{ kind: "edit" }, "no"],
        [{ kind: "execute", title: "Run `npm test`" }, "no"],
        [{ kind: "switch_mode", title: "Exit plan mode" }, "no"],
      ];
      for (const [call, expected] of rows) {
        expect(yield* acpAnswer(acpProfile, call)).toBe(expected);
      }
    }),
);

// witness: apps/server/src/spi/threadToolPolicy.ts | profiled ? "approval-required" : mode; → profiled && mode !== "full-access" ? "approval-required" : mode;
it("CD41: A crewmate on an agent whose gate is its own permission ask runs in the asking mode whatever mode its thread names, and a person's thread keeps its own", () => {
  const modes: ReadonlyArray<RuntimeMode> = [
    "approval-required",
    "auto-accept-edits",
    "auto",
    "full-access",
  ];
  for (const mode of modes) {
    expect(profiledRuntimeMode(true, mode)).toBe("approval-required");
    expect(profiledRuntimeMode(false, mode)).toBe(mode);
  }
});

const SERVER = "crew-0123456789";

/** The gate a crew lane's OpenCode crewmate meets. */
const openCodeGate = (call: {
  readonly toolName: string;
  readonly input: unknown;
}): ToolDecision => {
  const input = call.input as Record<string, unknown>;
  if (call.toolName.startsWith("mcp__crew__")) return { kind: "allow" };
  if (call.toolName === "mcp__zerops__zerops_logs") return { kind: "allow" };
  if (call.toolName === "Bash" && input.command === "npm test") return { kind: "allow" };
  if (call.toolName === "Bash" && input.command === "npm run dev") {
    return { kind: "allow", updatedInput: { command: "ssh appdev 'npm run dev'" } };
  }
  if (["Edit", "Read"].includes(call.toolName) && String(input.file_path).startsWith(CWD)) {
    return { kind: "allow" };
  }
  if (call.toolName === "Grep" || call.toolName === "Glob") return { kind: "allow" };
  return { kind: "deny", reason: "no" };
};

const openCodeProfile: ThreadToolProfile = {
  sessionContext: "",
  contextWindow: 1,
  decideTool: (call) => Effect.succeed(openCodeGate(call)),
  tools: [],
};

const ask = (fields: Partial<OpenCodePermissionAsk> & Pick<OpenCodePermissionAsk, "permission">) =>
  ({ id: "per_1", patterns: ["*"], metadata: {}, ...fields }) as OpenCodePermissionAsk;
const toolCall = (tool: string, input: Record<string, unknown>): OpenCodeToolInput => ({
  tool,
  input,
});

type OpenCodeRow = readonly [OpenCodePermissionAsk, OpenCodeToolInput | undefined, string];

// witness: apps/server/src/spi/openCodeThreadProfile.ts | keys.length === Object.keys(input).length && keys.every((key) => updated[key] === input[key]) → keys.every((key) => key in input)
it.effect(
  "CD42: A crewmate's OpenCode ask is answered once only when every call it makes passes the crew's gate unchanged; a rewrite, a refusal or a failing gate rejects it with the gate's reason for the model, and a question for the person or a doom loop is rejected",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<OpenCodeRow> = [
        [
          ask({ permission: "bash", patterns: ["npm test"] }),
          toolCall("bash", { command: "npm test" }),
          "once",
        ],
        [ask({ permission: "bash", metadata: { command: "npm test" } }), undefined, "once"],
        [ask({ permission: "edit", metadata: { filepath: `${CWD}/src/a.ts` } }), undefined, "once"],
        [ask({ permission: "read", patterns: ["src/a.ts"] }), undefined, "once"],
        [
          ask({ permission: "bash" }),
          toolCall("bash", { command: "npm test", workdir: "/etc" }),
          "reject",
        ],
        [ask({ permission: "bash" }), toolCall("bash", { command: "npm run dev" }), "reject"],
        [ask({ permission: "edit", patterns: ["src/a.ts", "../../etc/x"] }), undefined, "reject"],
        [ask({ permission: "question" }), undefined, "reject"],
        [ask({ permission: "doom_loop" }), undefined, "reject"],
      ];
      for (const [given, call, expected] of rows) {
        const answer = yield* decideOpenCodePermission(openCodeProfile, given, call, CWD, SERVER);
        expect(answer.reply).toBe(expected);
      }
      const failing = yield* decideOpenCodePermission(
        { ...openCodeProfile, decideTool: () => Effect.die("down") },
        ask({ permission: "bash" }),
        toolCall("bash", { command: "npm test" }),
        CWD,
        SERVER,
      );
      expect(failing.reply).toBe("reject");
      expect(
        yield* decideOpenCodePermission(
          openCodeProfile,
          ask({ permission: "bash" }),
          toolCall("bash", { command: "rm -rf /" }),
          CWD,
          SERVER,
        ),
      ).toEqual({ reply: "reject", message: "no" });
    }),
);

// witness: apps/server/src/spi/openCodeThreadProfile.ts | if (toolsServer !== undefined && key.startsWith(`${toolsServer}_`)) { → if (toolsServer !== undefined && key.includes("_crew_")) {
it.effect(
  "CD43: An OpenCode crew tool runs only on the crewmate's own crew server: the same tool on another thread's server is rejected",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<OpenCodeRow> = [
        [
          ask({ permission: `${SERVER}_crew_report` }),
          toolCall(`${SERVER}_crew_report`, { status: "done" }),
          "once",
        ],
        [ask({ permission: "crew-9999999999_crew_report" }), undefined, "reject"],
        [
          ask({ permission: "zerops_zerops_logs" }),
          toolCall("zerops_zerops_logs", { serviceHostname: "appdev" }),
          "once",
        ],
      ];
      for (const [given, call, expected] of rows) {
        const answer = yield* decideOpenCodePermission(openCodeProfile, given, call, CWD, SERVER);
        expect(answer.reply).toBe(expected);
      }
    }),
);

// witness: apps/server/src/spi/codexThreadProfile.ts | keys.length === Object.keys(input).length && keys.every((key) => updated[key] === input[key]) → keys.every((key) => key in input)
it.effect(
  "CD44: A crewmate's Codex command is accepted only when the crew's gate allows it unchanged within 15 seconds; a rewrite, a deny, a failing or a silent gate declines, and a request naming no command declines without asking the gate",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<readonly [ThreadToolProfile["decideTool"], string]> = [
        [() => Effect.succeed({ kind: "allow" }), "accept"],
        [
          ({ input }) =>
            Effect.succeed({ kind: "allow", updatedInput: input as Record<string, unknown> }),
          "accept",
        ],
        [
          () =>
            Effect.succeed({
              kind: "allow",
              updatedInput: { command: "ssh appdev 'cd /var/www/.crew/backend && npm test'" },
            }),
          "decline",
        ],
        [() => Effect.succeed({ kind: "deny", reason: "outside your copy" }), "decline"],
        [() => Effect.die(new Error("gate crashed")), "decline"],
        [() => Effect.never, "decline"],
      ];
      for (const [decideTool, expected] of rows) {
        const { calls, profile } = recording(decideTool);
        const decision = yield* codexThreadSetup(profile)
          .decideCommand({ itemId: "call_exec_1", command: "npm test" })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust("15 seconds");
        expect(yield* Fiber.join(decision)).toBe(expected);
        expect(calls).toEqual([
          { toolName: "Bash", input: { command: "npm test" }, toolUseId: "call_exec_1" },
        ]);
      }
      const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
      expect(
        yield* codexThreadSetup(profile).decideCommand({ itemId: "call_exec_1", command: null }),
      ).toBe("decline");
      expect(calls).toEqual([]);
    }),
);

// witness: apps/server/src/spi/codexThreadProfile.ts | const COMMAND_SHELLS = new Set(["sh", "bash", "zsh"]); → const COMMAND_SHELLS = new Set(["sh", "bash", "zsh", "fish"]);
it.effect(
  "CD45: The crew's gate judges the command Codex's sh, bash or zsh runs inside -c or -lc, and any other shell, flag, trailing word, operator or unclosed quote as it stands",
  () =>
    Effect.gen(function* () {
      // The lane form a writer must write, and Codex's rendering of the argv it
      // runs it with: its login shell, `-lc`, the command double-quoted.
      const laneForm =
        "ssh appdev 'cd /var/www/.crew/cx && CREW_PORT=3003 timeout 600 sh -c '\\''npm test'\\'''";
      const live =
        "/usr/bin/zsh -lc \"ssh appdev 'cd /var/www/.crew/cx && CREW_PORT=3003 timeout 600 sh -c '\\\\''npm test'\\\\'''\"";
      const rows: ReadonlyArray<readonly [string, string]> = [
        [live, laneForm],
        [`/usr/bin/zsh -lc "${laneForm}"`, laneForm],
        [live.replace("/usr/bin/zsh -lc", "bash -c"), laneForm],
        [live.replace("/usr/bin/zsh -lc", "/bin/sh -lc"), laneForm],
        ["/bin/bash -lc 'ssh appdev \"npm test\"'", 'ssh appdev "npm test"'],
        ['/usr/bin/zsh -lc "echo \\$HOME"', "echo $HOME"],
        [laneForm, laneForm],
        [`/usr/bin/fish -c "${laneForm}"`, `/usr/bin/fish -c "${laneForm}"`],
        ['/usr/bin/zsh -x -c "npm test"', '/usr/bin/zsh -x -c "npm test"'],
        ['/usr/bin/zsh -lc "npm test" extra', '/usr/bin/zsh -lc "npm test" extra'],
        [
          '/usr/bin/zsh -lc "npm test"; rm -rf /var/www',
          '/usr/bin/zsh -lc "npm test"; rm -rf /var/www',
        ],
        ['/usr/bin/zsh -lc "npm test', '/usr/bin/zsh -lc "npm test'],
      ];
      for (const [command, gateSees] of rows) {
        const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
        yield* codexThreadSetup(profile).decideCommand({ itemId: "call_exec_1", command });
        expect(calls).toEqual([
          { toolName: "Bash", input: { command: gateSees }, toolUseId: "call_exec_1" },
        ]);
      }
    }),
);

const fileChange = (path: string, kind: CodexFileChange["kind"]): CodexFileChange => ({
  path,
  kind,
  diff: "",
});

// witness: apps/server/src/spi/codexThreadProfile.ts | if (checks.length === 0) return "decline"; → if (checks.length === 0) return "accept";
it.effect(
  "CD46: A Codex file change is accepted only when the gate allows every file it touches, a new file and a move's target as a Write and an update or deletion as an Edit, relative paths in the session's directory; the first refused path, or a change naming no file, declines it",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<
        readonly [ReadonlyArray<CodexFileChange>, ReadonlyArray<readonly [string, string]>]
      > = [
        [[fileChange(`${CWD}/src/new.ts`, { type: "add" })], [["Write", `${CWD}/src/new.ts`]]],
        [
          [
            fileChange(`${CWD}/src/a.ts`, { type: "update", move_path: null }),
            fileChange(`${CWD}/src/b.ts`, { type: "delete" }),
          ],
          [
            ["Edit", `${CWD}/src/a.ts`],
            ["Edit", `${CWD}/src/b.ts`],
          ],
        ],
        [
          [fileChange(`${CWD}/old.ts`, { type: "update", move_path: `${CWD}/new.ts` })],
          [
            ["Edit", `${CWD}/old.ts`],
            ["Write", `${CWD}/new.ts`],
          ],
        ],
        [
          [fileChange("src/a.ts", { type: "update", move_path: "src/b.ts" })],
          [
            ["Edit", `${CWD}/src/a.ts`],
            ["Write", `${CWD}/src/b.ts`],
          ],
        ],
      ];
      for (const [changes, expected] of rows) {
        const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
        expect(
          yield* codexThreadSetup(profile).decideFileChange({
            itemId: "call_patch_1",
            cwd: CWD,
            changes,
          }),
        ).toBe("accept");
        expect(calls).toEqual(
          expected.map(([toolName, path]) => ({
            toolName,
            input: { file_path: path },
            toolUseId: "call_patch_1",
          })),
        );
      }

      const refused = recording(({ input }) =>
        Effect.succeed(
          (input as { file_path: string }).file_path.endsWith("/b.ts")
            ? { kind: "deny", reason: "another crewmate's migrations" }
            : { kind: "allow" },
        ),
      );
      expect(
        yield* codexThreadSetup(refused.profile).decideFileChange({
          itemId: "call_patch_1",
          cwd: CWD,
          changes: [
            fileChange(`${CWD}/a.ts`, { type: "add" }),
            fileChange(`${CWD}/b.ts`, { type: "add" }),
            fileChange(`${CWD}/c.ts`, { type: "add" }),
          ],
        }),
      ).toBe("decline");
      expect(refused.calls.length).toBe(2);

      for (const changes of [undefined, []]) {
        const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
        expect(
          yield* codexThreadSetup(profile).decideFileChange({
            itemId: "call_patch_1",
            cwd: CWD,
            changes,
          }),
        ).toBe("decline");
        expect(calls).toEqual([]);
      }
    }),
);

// witness: apps/server/src/spi/codexThreadProfile.ts | sandboxPolicy: { type: profile.readOnly ? "readOnly" : "workspaceWrite" }, → sandboxPolicy: { type: "workspaceWrite" },
it("CD47: A crewmate's Codex thread and every turn run untrusted with the person as reviewer, without zcp's MCP server, with the crew's context window as its compaction limit, and in the read-only sandbox when the profile only reads", () => {
  const setup = codexThreadSetup(PROFILE);
  expect(setup.thread).toEqual({
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    developerInstructions: PROFILE.sessionContext,
    config: {
      "mcp_servers.zerops.enabled": false,
      model_auto_compact_token_limit: PROFILE.contextWindow,
    },
  });
  expect(setup.turn).toEqual({
    approvalPolicy: "untrusted",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "workspaceWrite" },
  });
  const rows = [
    [undefined, "workspace-write", "workspaceWrite"],
    [false, "workspace-write", "workspaceWrite"],
    [true, "read-only", "readOnly"],
  ] as const;
  for (const [readOnly, sandbox, sandboxPolicy] of rows) {
    const readOnlySetup = codexThreadSetup({
      ...PROFILE,
      ...(readOnly === undefined ? {} : { readOnly }),
    });
    expect(readOnlySetup.thread.sandbox).toBe(sandbox);
    expect(readOnlySetup.turn.sandboxPolicy).toEqual({ type: sandboxPolicy });
  }
});

const CODEX_THREAD = {
  threadId: ThreadId.make("crew-thread"),
  instanceId: ProviderInstanceId.make("codex"),
};
const CODEX_SELECTION: ModelSelection = {
  instanceId: CODEX_THREAD.instanceId,
  model: "gpt-5.6-sol",
};

/** What a Codex session starts with under one installed policy that answers with `profile`. */
const codexStartWith = (profile: ThreadToolProfile | undefined) =>
  Effect.scoped(
    Effect.gen(function* () {
      const slot = yield* makeInstallSlot<ThreadToolPolicy>();
      yield* slot.install({ profileFor: () => Effect.succeed(profile) });
      return yield* codexThreadStart(Option.some(slot), CODEX_THREAD, CODEX_SELECTION);
    }),
  );

// witness: apps/server/src/spi/codexThreadProfile.ts | developerInstructions: [projectGuidance, profile.sessionContext, profile.exactCallsContext] → developerInstructions: [profile.sessionContext, projectGuidance, profile.exactCallsContext]
it.effect(
  "CD48: A Codex crewmate in its own lane hears the project's AGENTS.md once, before the crew's context; at the project root, or in a project without one, it hears only the crew's context",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const project = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(path.join(project, "AGENTS.md"), "# Project\n\nDeploy with zcp.\n");
      const noGuidance = yield* fs.makeTempDirectoryScoped();
      const rows: ReadonlyArray<readonly [string | undefined, string]> = [
        [
          project,
          `# AGENTS.md instructions for ${project}\n\n<INSTRUCTIONS>\n# Project\n\nDeploy with zcp.\n\n</INSTRUCTIONS>\n\n${PROFILE.sessionContext}`,
        ],
        [undefined, PROFILE.sessionContext],
        [noGuidance, PROFILE.sessionContext],
      ];
      for (const [projectRoot, expected] of rows) {
        const started = yield* codexStartWith({
          ...PROFILE,
          ...(projectRoot === undefined ? {} : { projectRoot }),
        });
        expect(started.setup?.thread.developerInstructions).toBe(expected);
      }
      const exactCalls = codexThreadSetup({
        ...PROFILE,
        exactCallsContext: "# Commands\n\nExactly so.",
      });
      expect(exactCalls.thread.developerInstructions).toBe(
        `${PROFILE.sessionContext}\n\n# Commands\n\nExactly so.`,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/spi/threadToolPolicy.ts | if (!profile || !model || (profile.model === undefined && effort === undefined)) { → if (!profile || (profile.model === undefined && effort === undefined)) {
it("CD49: A crewmate's model and effort replace its thread's own, the thread's other options kept; an effort alone, with no model to apply it to or on a driver without an effort option, changes nothing", () => {
  const profile = (fields: Partial<ThreadToolProfile>): ThreadToolProfile => ({
    ...PROFILE,
    ...fields,
  });

  const cursor = ProviderInstanceId.make("cursor");
  const cursorOwn: ModelSelection = {
    instanceId: cursor,
    model: "auto",
    options: [
      { id: "reasoning", value: "low" },
      { id: "fast", value: true },
    ],
  };
  const driverRows: ReadonlyArray<
    readonly [
      ThreadToolProfile | undefined,
      ModelSelection | undefined,
      string | undefined,
      ModelSelection | undefined,
    ]
  > = [
    [undefined, cursorOwn, "reasoning", cursorOwn],
    [profile({}), cursorOwn, "reasoning", cursorOwn],
    [
      profile({ model: "gpt-5", effort: "high" }),
      cursorOwn,
      "reasoning",
      {
        instanceId: cursor,
        model: "gpt-5",
        options: [
          { id: "fast", value: true },
          { id: "reasoning", value: "high" },
        ],
      },
    ],
    [profile({ effort: "high" }), cursorOwn, undefined, cursorOwn],
    [profile({ effort: "high" }), undefined, "reasoning", undefined],
  ];
  for (const [given, selection, effortOption, expected] of driverRows) {
    expect(profileModelSelection(given, cursor, selection, effortOption)).toEqual(expected);
  }

  const codex = ProviderInstanceId.make("codex");
  const codexOwn: ModelSelection = {
    instanceId: codex,
    model: "gpt-5.6-sol",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ],
  };
  const codexRows: ReadonlyArray<
    readonly [ThreadToolProfile | undefined, ModelSelection | undefined, ModelSelection | undefined]
  > = [
    [undefined, codexOwn, codexOwn],
    [profile({}), codexOwn, codexOwn],
    [profile({ model: "gpt-5.6-luna" }), codexOwn, { ...codexOwn, model: "gpt-5.6-luna" }],
    [
      profile({ effort: "low" }),
      codexOwn,
      {
        ...codexOwn,
        options: [
          { id: "fastMode", value: true },
          { id: "reasoningEffort", value: "low" },
        ],
      },
    ],
    [
      profile({ model: "gpt-5.6-luna", effort: "low" }),
      undefined,
      {
        instanceId: codex,
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    ],
    [profile({ effort: "low" }), undefined, undefined],
  ];
  for (const [given, selection, expected] of codexRows) {
    expect(codexProfileModelSelection(given, codex, selection)).toEqual(expected);
  }
});

type SlotStep = { readonly install: "first" | "second" } | { readonly release: "first" | "second" };

// witness: apps/server/src/spi/threadToolPolicy.ts | Option.isSome(current) && current.value === entry ? Option.none() : current, → Option.isSome(current) ? Option.none() : current,
it.effect(
  "CD50: The latest crew policy installed is the current one until its own scope closes: closing an earlier install leaves the later one, and closing the later one brings no earlier one back",
  () =>
    Effect.gen(function* () {
      const rows: ReadonlyArray<readonly [ReadonlyArray<SlotStep>, "first" | "second" | "none"]> = [
        [[], "none"],
        [[{ install: "first" }], "first"],
        [[{ install: "first" }, { release: "first" }], "none"],
        [[{ install: "first" }, { install: "second" }], "second"],
        [[{ install: "first" }, { install: "second" }, { release: "first" }], "second"],
        [[{ install: "first" }, { install: "second" }, { release: "second" }], "none"],
      ];
      for (const [steps, current] of rows) {
        const installed = yield* Effect.gen(function* () {
          const registry = yield* ThreadToolPolicyRegistry;
          const policies: Record<"first" | "second", ThreadToolPolicy> = {
            first: { profileFor: () => Effect.succeed(undefined) },
            second: { profileFor: () => Effect.succeed(undefined) },
          };
          const scopes = new Map<"first" | "second", Scope.Closeable>();
          for (const step of steps) {
            if ("install" in step) {
              const scope = yield* Scope.make();
              scopes.set(step.install, scope);
              yield* registry.install(policies[step.install]).pipe(Scope.provide(scope));
            } else {
              yield* Scope.close(scopes.get(step.release)!, Exit.void);
            }
          }
          const now = Option.getOrUndefined(yield* registry.current);
          return now === undefined ? "none" : now === policies.first ? "first" : "second";
        }).pipe(Effect.provide(ThreadToolPolicyRegistry.layer));
        expect(installed).toBe(current);
      }

      const empty = yield* Effect.scoped(
        Effect.gen(function* () {
          const slot = yield* makeInstallSlot<ThreadToolPolicy>();
          yield* slot.install({ profileFor: () => Effect.succeed(undefined) });
          return [
            yield* codexThreadStart(Option.none(), CODEX_THREAD, CODEX_SELECTION),
            yield* codexThreadStart(Option.some(slot), CODEX_THREAD, CODEX_SELECTION),
          ];
        }),
      );
      for (const started of empty) {
        expect(started).toEqual({ setup: undefined, modelSelection: CODEX_SELECTION });
      }
      const started = yield* codexStartWith({ ...PROFILE, model: "gpt-5.6-luna" });
      expect(started.setup?.thread.developerInstructions).toBe(PROFILE.sessionContext);
      expect(started.modelSelection).toEqual({ ...CODEX_SELECTION, model: "gpt-5.6-luna" });
    }),
);
