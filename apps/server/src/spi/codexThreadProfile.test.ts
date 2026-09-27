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

  for (const { name, decideTool, expected } of CASES) {
    it.effect(name, () =>
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
  }

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

  for (const { name, changes, calls: expectedCalls } of CASES) {
    it.effect(`${name}; every path allowed accepts`, () =>
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
  }

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

  for (const [name, changes] of [
    ["a change whose files are unknown", undefined],
    ["a change that names no file", []],
  ] as const) {
    it.effect(`declines ${name}, without asking the gate`, () =>
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
  }
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

  for (const { name, profile, selection, expected } of CASES) {
    it(name, () => {
      assert.deepStrictEqual(
        codexProfileModelSelection(
          profile === undefined ? undefined : { ...PROFILE, ...profile },
          INSTANCE_ID,
          selection,
        ),
        expected,
      );
    });
  }
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

  for (const [readOnly, sandbox, sandboxPolicy] of [
    [undefined, "workspace-write", { type: "workspaceWrite" }],
    [false, "workspace-write", { type: "workspaceWrite" }],
    [true, "read-only", { type: "readOnly" }],
  ] as const) {
    it(`a profile read only ${readOnly} runs in the ${sandbox} sandbox`, () => {
      const setup = codexThreadSetup({
        ...PROFILE,
        ...(readOnly === undefined ? {} : { readOnly }),
      });
      assert.strictEqual(setup.thread.sandbox, sandbox);
      assert.deepStrictEqual(setup.turn.sandboxPolicy, sandboxPolicy);
    });
  }
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
