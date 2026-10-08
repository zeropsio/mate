import { assert, describe, it } from "@effect/vitest";
import { type ModelSelection, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import {
  type CodexFileChange,
  codexProfileModelSelection,
  codexThreadStart,
  codexThreadSetup,
} from "./codexThreadProfile.ts";
import {
  makeInstallSlot,
  type ThreadToolPolicy,
  type ThreadToolProfile,
} from "./threadToolPolicy.ts";

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

describe("a Codex command approval, answered by the thread's gate", () => {
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly decideTool: ThreadToolProfile["decideTool"];
    readonly expected: "accept" | "decline";
  }> = [
    {
      name: "an allow accepts",
      decideTool: () => Effect.succeed({ kind: "allow" }),
      expected: "accept",
    },
    {
      name: "an allow that keeps the command as it is accepts",
      decideTool: ({ input }) =>
        Effect.succeed({ kind: "allow", updatedInput: input as Record<string, unknown> }),
      expected: "accept",
    },
    {
      name: "an allow that rewrites the command declines: Codex runs only what it asked",
      decideTool: () =>
        Effect.succeed({
          kind: "allow",
          updatedInput: { command: "ssh appdev 'cd /var/www/.crew/backend && npm test'" },
        }),
      expected: "decline",
    },
    {
      name: "a deny declines",
      decideTool: () => Effect.succeed({ kind: "deny", reason: "outside your copy" }),
      expected: "decline",
    },
    {
      name: "a throwing gate declines",
      decideTool: () => Effect.die(new Error("gate crashed")),
      expected: "decline",
    },
    {
      name: "a gate silent for 15 s declines",
      decideTool: () => Effect.never,
      expected: "decline",
    },
  ];

  it.effect.each(
    Array.from(CASES, ({ name, decideTool, expected }) => ({ title: name, decideTool, expected })),
  )("$title", ({ decideTool, expected }) =>
    Effect.gen(function* () {
      const { calls, profile } = recording(decideTool);
      const decision = yield* codexThreadSetup(profile)
        .decideCommand({ itemId: "call_exec_1", command: "npm test" })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("15 seconds");
      assert.strictEqual(yield* Fiber.join(decision), expected);
      assert.deepStrictEqual(calls, [
        { toolName: "Bash", input: { command: "npm test" }, toolUseId: "call_exec_1" },
      ]);
    }),
  );

  it.effect("declines a request that names no command, without asking the gate", () =>
    Effect.gen(function* () {
      const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
      const decision = yield* codexThreadSetup(profile).decideCommand({
        itemId: "call_exec_1",
        command: null,
      });
      assert.strictEqual(decision, "decline");
      assert.deepStrictEqual(calls, []);
    }),
  );
});

describe("a Codex command wrapped in its shell, as its approval names it", () => {
  // The lane form a writer must write (CrewPolicy), and Codex's rendering of
  // the argv it runs it with: its login shell, `-lc`, the command double-quoted.
  const LANE_FORM =
    "ssh appdev 'cd /var/www/.crew/cx && CREW_PORT=3003 timeout 600 sh -c '\\''npm test'\\'''";
  const LIVE =
    "/usr/bin/zsh -lc \"ssh appdev 'cd /var/www/.crew/cx && CREW_PORT=3003 timeout 600 sh -c '\\\\''npm test'\\\\'''\"";

  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly command: string;
    readonly gateSees: string;
  }> = [
    { name: "zsh -lc, as the live probe saw it", command: LIVE, gateSees: LANE_FORM },
    {
      name: "a backslash left as it is inside the double quotes",
      command: `/usr/bin/zsh -lc "${LANE_FORM}"`,
      gateSees: LANE_FORM,
    },
    { name: "bash -c", command: LIVE.replace("/usr/bin/zsh -lc", "bash -c"), gateSees: LANE_FORM },
    {
      name: "sh -lc",
      command: LIVE.replace("/usr/bin/zsh -lc", "/bin/sh -lc"),
      gateSees: LANE_FORM,
    },
    {
      name: "a single-quoted script",
      command: "/bin/bash -lc 'ssh appdev \"npm test\"'",
      gateSees: 'ssh appdev "npm test"',
    },
    {
      name: "a double-quoted script with an escaped dollar",
      command: '/usr/bin/zsh -lc "echo \\$HOME"',
      gateSees: "echo $HOME",
    },
    { name: "no shell around it", command: LANE_FORM, gateSees: LANE_FORM },
    {
      name: "another shell, as it is",
      command: `/usr/bin/fish -c "${LANE_FORM}"`,
      gateSees: `/usr/bin/fish -c "${LANE_FORM}"`,
    },
    {
      name: "another flag, as it is",
      command: '/usr/bin/zsh -x -c "npm test"',
      gateSees: '/usr/bin/zsh -x -c "npm test"',
    },
    {
      name: "a word after the script, as it is",
      command: '/usr/bin/zsh -lc "npm test" extra',
      gateSees: '/usr/bin/zsh -lc "npm test" extra',
    },
    {
      name: "an operator outside the quotes, as it is",
      command: '/usr/bin/zsh -lc "npm test"; rm -rf /var/www',
      gateSees: '/usr/bin/zsh -lc "npm test"; rm -rf /var/www',
    },
    {
      name: "an unclosed quote, as it is",
      command: '/usr/bin/zsh -lc "npm test',
      gateSees: '/usr/bin/zsh -lc "npm test',
    },
  ];

  it.effect.each(
    Array.from(CASES, ({ name, command, gateSees }) => ({
      title: `hands the gate the command its shell runs: ${name}`,
      command,
      gateSees,
    })),
  )("$title", ({ command, gateSees }) =>
    Effect.gen(function* () {
      const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
      yield* codexThreadSetup(profile).decideCommand({ itemId: "call_exec_1", command });
      assert.deepStrictEqual(calls, [
        { toolName: "Bash", input: { command: gateSees }, toolUseId: "call_exec_1" },
      ]);
    }),
  );
});

describe("a Codex file change approval, answered by the thread's gate", () => {
  const CWD = "/var/www/.crew/backend";
  const change = (path: string, kind: CodexFileChange["kind"]): CodexFileChange => ({
    path,
    kind,
    diff: "",
  });

  // Each row: the item's changes, and the calls the gate must see for them.
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly changes: ReadonlyArray<CodexFileChange>;
    readonly calls: ReadonlyArray<{ readonly toolName: string; readonly path: string }>;
  }> = [
    {
      name: "an added file is a Write",
      changes: [change(`${CWD}/src/new.ts`, { type: "add" })],
      calls: [{ toolName: "Write", path: `${CWD}/src/new.ts` }],
    },
    {
      name: "an updated and a deleted file are Edits",
      changes: [
        change(`${CWD}/src/a.ts`, { type: "update", move_path: null }),
        change(`${CWD}/src/b.ts`, { type: "delete" }),
      ],
      calls: [
        { toolName: "Edit", path: `${CWD}/src/a.ts` },
        { toolName: "Edit", path: `${CWD}/src/b.ts` },
      ],
    },
    {
      name: "a moved file is an Edit of its source and a Write of its target",
      changes: [change(`${CWD}/old.ts`, { type: "update", move_path: `${CWD}/new.ts` })],
      calls: [
        { toolName: "Edit", path: `${CWD}/old.ts` },
        { toolName: "Write", path: `${CWD}/new.ts` },
      ],
    },
    {
      name: "a relative path is the session's cwd's",
      changes: [change("src/a.ts", { type: "update", move_path: "src/b.ts" })],
      calls: [
        { toolName: "Edit", path: `${CWD}/src/a.ts` },
        { toolName: "Write", path: `${CWD}/src/b.ts` },
      ],
    },
  ];

  it.effect.each(
    Array.from(CASES, ({ name, changes, calls: expectedCalls }) => ({
      title: `${name}; every path allowed accepts`,
      changes,
      expectedCalls,
    })),
  )("$title", ({ changes, expectedCalls }) =>
    Effect.gen(function* () {
      const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
      const decision = yield* codexThreadSetup(profile).decideFileChange({
        itemId: "call_patch_1",
        cwd: CWD,
        changes,
      });
      assert.strictEqual(decision, "accept");
      assert.deepStrictEqual(
        calls,
        expectedCalls.map(({ toolName, path }) => ({
          toolName,
          input: { file_path: path },
          toolUseId: "call_patch_1",
        })),
      );
    }),
  );

  it.effect("one refused path declines the whole change", () =>
    Effect.gen(function* () {
      const { calls, profile } = recording(({ input }) =>
        Effect.succeed(
          (input as { file_path: string }).file_path.endsWith("/b.ts")
            ? { kind: "deny", reason: "another crewmate's migrations" }
            : { kind: "allow" },
        ),
      );
      const decision = yield* codexThreadSetup(profile).decideFileChange({
        itemId: "call_patch_1",
        cwd: CWD,
        changes: [
          change(`${CWD}/a.ts`, { type: "add" }),
          change(`${CWD}/b.ts`, { type: "add" }),
          change(`${CWD}/c.ts`, { type: "add" }),
        ],
      });
      assert.strictEqual(decision, "decline");
      assert.strictEqual(calls.length, 2, "the gate was asked past the first refusal");
    }),
  );

  it.effect.each(
    Array.from(
      [
        ["a change whose files are unknown", undefined],
        ["a change that names no file", []],
      ] as const,
      ([name, changes]) => ({ title: `declines ${name}, without asking the gate`, changes }),
    ),
  )("$title", ({ changes }) =>
    Effect.gen(function* () {
      const { calls, profile } = recording(() => Effect.succeed({ kind: "allow" }));
      const decision = yield* codexThreadSetup(profile).decideFileChange({
        itemId: "call_patch_1",
        cwd: CWD,
        changes,
      });
      assert.strictEqual(decision, "decline");
      assert.deepStrictEqual(calls, []);
    }),
  );
});

describe("the model a profiled Codex thread runs", () => {
  const INSTANCE_ID = ProviderInstanceId.make("codex");
  const THREAD: ModelSelection = {
    instanceId: INSTANCE_ID,
    model: "gpt-5.6-sol",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ],
  };

  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly profile: Partial<ThreadToolProfile> | undefined;
    readonly selection: ModelSelection | undefined;
    readonly expected: ModelSelection | undefined;
  }> = [
    {
      name: "no profile keeps the thread's",
      profile: undefined,
      selection: THREAD,
      expected: THREAD,
    },
    {
      name: "a profile without Runs-on keeps the thread's",
      profile: {},
      selection: THREAD,
      expected: THREAD,
    },
    {
      name: "the profile's model replaces the thread's, whose options stay",
      profile: { model: "gpt-5.6-luna" },
      selection: THREAD,
      expected: { ...THREAD, model: "gpt-5.6-luna" },
    },
    {
      name: "the profile's effort replaces the thread's reasoning effort",
      profile: { effort: "low" },
      selection: THREAD,
      expected: {
        ...THREAD,
        options: [
          { id: "fastMode", value: true },
          { id: "reasoningEffort", value: "low" },
        ],
      },
    },
    {
      name: "a model and an effort on a thread with no selection",
      profile: { model: "gpt-5.6-luna", effort: "low" },
      selection: undefined,
      expected: {
        instanceId: INSTANCE_ID,
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    },
    {
      name: "an effort alone needs a model, so a thread with no selection keeps none",
      profile: { effort: "low" },
      selection: undefined,
      expected: undefined,
    },
  ];

  it.each(
    Array.from(CASES, ({ name, profile, selection, expected }) => ({
      title: name,
      profile,
      selection,
      expected,
    })),
  )("$title", ({ profile, selection, expected }) => {
    assert.deepStrictEqual(
      codexProfileModelSelection(
        profile === undefined ? undefined : { ...PROFILE, ...profile },
        INSTANCE_ID,
        selection,
      ),
      expected,
    );
  });
});

describe("the thread and turn a profiled Codex thread starts", () => {
  it("asks for every command and file change, without zcp's tools, with the crew's context and window", () => {
    const setup = codexThreadSetup(PROFILE);
    assert.deepStrictEqual(setup.thread, {
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      developerInstructions: PROFILE.sessionContext,
      config: {
        "mcp_servers.zerops.enabled": false,
        model_auto_compact_token_limit: PROFILE.contextWindow,
      },
    });
    assert.deepStrictEqual(setup.turn, {
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "workspaceWrite" },
    });
  });

  it("adds the profile's exact-calls context to its developer instructions", () => {
    const setup = codexThreadSetup({ ...PROFILE, exactCallsContext: "# Commands\n\nExactly so." });
    assert.strictEqual(
      setup.thread.developerInstructions,
      `${PROFILE.sessionContext}\n\n# Commands\n\nExactly so.`,
    );
  });

  it.each(
    Array.from(
      [
        [undefined, "workspace-write", { type: "workspaceWrite" }],
        [false, "workspace-write", { type: "workspaceWrite" }],
        [true, "read-only", { type: "readOnly" }],
      ] as const,
      ([readOnly, sandbox, sandboxPolicy]) => ({
        title: `a profile read only ${readOnly} runs in the ${sandbox} sandbox`,
        readOnly,
        sandbox,
        sandboxPolicy,
      }),
    ),
  )("$title", ({ readOnly, sandbox, sandboxPolicy }) => {
    const setup = codexThreadSetup({
      ...PROFILE,
      ...(readOnly === undefined ? {} : { readOnly }),
    });
    assert.strictEqual(setup.thread.sandbox, sandbox);
    assert.deepStrictEqual(setup.turn.sandboxPolicy, sandboxPolicy);
  });
});

describe("a Codex session start asks the installed policy", () => {
  const THREAD = {
    threadId: ThreadId.make("crew-thread"),
    instanceId: ProviderInstanceId.make("codex"),
  };
  const SELECTION: ModelSelection = { instanceId: THREAD.instanceId, model: "gpt-5.6-sol" };

  it.effect("no policy, or no profile for the thread: no setup and the thread's own model", () =>
    Effect.gen(function* () {
      const slot = yield* makeInstallSlot<ThreadToolPolicy>();
      yield* slot.install({ profileFor: () => Effect.succeed(undefined) });
      for (const policies of [Option.none(), Option.some(slot)]) {
        assert.deepStrictEqual(yield* codexThreadStart(policies, THREAD, SELECTION), {
          setup: undefined,
          modelSelection: SELECTION,
        });
      }
    }).pipe(Effect.scoped),
  );

  it.effect("a profile: its setup and its model", () =>
    Effect.gen(function* () {
      const slot = yield* makeInstallSlot<ThreadToolPolicy>();
      yield* slot.install({
        profileFor: () => Effect.succeed({ ...PROFILE, model: "gpt-5.6-luna" }),
      });
      const started = yield* codexThreadStart(Option.some(slot), THREAD, SELECTION);
      assert.strictEqual(started.setup?.thread.developerInstructions, PROFILE.sessionContext);
      assert.deepStrictEqual(started.modelSelection, { ...SELECTION, model: "gpt-5.6-luna" });
    }).pipe(Effect.scoped),
  );
});
