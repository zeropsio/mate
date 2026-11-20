import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ANTIGRAVITY_DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { type AcpError, AcpRequestError } from "effect-acp/errors";
import type * as AcpSchema from "effect-acp/compat";
import { expect } from "vite-plus/test";

import type { AcpSessionRuntimeEvent } from "../spi/antigravityAcp.ts";

import {
  type AntigravityTextGenerationOptions,
  makeAntigravityTextGeneration,
} from "./AntigravityTextGeneration.ts";

type TextRuntime = Effect.Success<ReturnType<AntigravityTextGenerationOptions["makeRuntime"]>>;

const SESSION_ID = "047c62f6-607b-44db-bfbe-f83b67e9e8b1";
const modelSelection = {
  instanceId: ProviderInstanceId.make("antigravity-test"),
  model: "gemini-test",
};

const nativeRequestContext = { requestId: "native-request", method: "test" };

interface PromptContext {
  readonly emit: (
    update: AcpSchema.SessionNotification["update"],
    sessionId?: string,
  ) => Effect.Effect<void, AcpError>;
  permission: Parameters<TextRuntime["handleRequestPermission"]>[0];
  question: Parameters<TextRuntime["handleElicitation"]>[0];
  readFile: Parameters<TextRuntime["handleReadTextFile"]>[0];
  createTerminal: Parameters<TextRuntime["handleCreateTerminal"]>[0];
  extension: Parameters<TextRuntime["handleUnknownExtRequest"]>[0];
  readonly cwd: string;
}

const makeFixture = Effect.fn("makeAntigravityTextGenerationFixture")(function* (
  options: {
    readonly outputs?: ReadonlyArray<string>;
    readonly prompt?: (context: PromptContext) => Effect.Effect<AcpSchema.PromptResponse, AcpError>;
    readonly startError?: AcpError;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-antigravity-text-test-" });
  const projectDirectory = path.join(root, "project");
  const nativeSessionId = SESSION_ID;
  yield* fs.makeDirectory(projectDirectory, { recursive: true });
  yield* fs.writeFileString(path.join(projectDirectory, "keep.txt"), "untouched");
  const enteredPrompt = yield* Deferred.make<void>();
  const state = {
    workspaces: [] as Array<string>,
    closed: [] as Array<string>,
    prompts: [] as Array<Parameters<TextRuntime["prompt"]>[0]>,
    selectedModels: [] as Array<string>,
    selectedModes: [] as Array<string>,
    cancellations: 0,
  };
  const outputs = [...(options.outputs ?? ['{"title":"Repair login"}'])];
  const incoming: Omit<PromptContext, "cwd" | "emit"> = {
    permission: () => Effect.die("No permission handler."),
    question: () => Effect.die("No question handler."),
    readFile: () => Effect.die("No file handler."),
    createTerminal: () => Effect.die("No terminal handler."),
    extension: () => Effect.die("No extension handler."),
  };

  const makeRuntime: AntigravityTextGenerationOptions["makeRuntime"] = (cwd) =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<AcpSessionRuntimeEvent>();
      state.workspaces.push(cwd);
      expect(yield* fs.readDirectory(cwd).pipe(Effect.orDie)).toEqual([]);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          state.closed.push(cwd);
        }),
      );
      let sessionUpdate: Parameters<TextRuntime["handleSessionUpdate"]>[0] = () => Effect.void;

      return {
        start: () =>
          Effect.gen(function* () {
            if (options.startError) return yield* options.startError;
            return {
              sessionId: nativeSessionId,
              initializeResult: { protocolVersion: 1 },
              sessionSetupResult: { sessionId: nativeSessionId },
              modelConfigId: "model",
            };
          }),
        setMode: (mode) =>
          Effect.sync(() => {
            state.selectedModes.push(mode);
            return {};
          }),
        getConfigOptions: Effect.succeed([
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: modelSelection.model,
            options: [{ value: modelSelection.model, name: "Gemini test" }],
          },
        ]),
        getEvents: () => Stream.fromQueue(events),
        setModel: (model) =>
          Effect.sync(() => {
            state.selectedModels.push(model);
          }),
        prompt: (request) =>
          Effect.gen(function* () {
            state.prompts.push(request);
            yield* Deferred.succeed(enteredPrompt, undefined);
            const emit: PromptContext["emit"] = (update, sessionId = nativeSessionId) =>
              sessionUpdate({ sessionId, update });
            if (options.prompt) {
              return yield* options.prompt({
                emit,
                ...incoming,
                cwd,
              });
            }
            const output = outputs.shift() ?? '{"title":"Repair login"}';
            yield* emit({
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "Choose concise text." },
            });
            yield* emit(
              {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "unrelated session" },
              },
              "another-session",
            );
            for (const text of [output.slice(0, 9), output.slice(9)]) {
              yield* emit({
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text },
              });
            }
            return { stopReason: "end_turn" };
          }),
        cancel: Effect.gen(function* () {
          state.cancellations += 1;
          const acknowledge = yield* Deferred.make<void>();
          yield* Queue.offer(events, { _tag: "EventStreamBarrier", acknowledge });
          yield* Deferred.await(acknowledge);
        }),
        handleSessionUpdate: (handler) =>
          Effect.sync(() => {
            sessionUpdate = handler;
          }),
        handleRequestPermission: (handler) =>
          Effect.sync(() => {
            incoming.permission = handler;
          }),
        handleElicitation: (handler) =>
          Effect.sync(() => {
            incoming.question = handler;
          }),
        handleReadTextFile: (handler) =>
          Effect.sync(() => {
            incoming.readFile = handler;
          }),
        handleWriteTextFile: () => Effect.void,
        handleCreateTerminal: (handler) =>
          Effect.sync(() => {
            incoming.createTerminal = handler;
          }),
        handleTerminalOutput: () => Effect.void,
        handleTerminalWaitForExit: () => Effect.void,
        handleTerminalKill: () => Effect.void,
        handleTerminalRelease: () => Effect.void,
        handleUnknownExtRequest: (handler) =>
          Effect.sync(() => {
            incoming.extension = handler;
          }),
      } satisfies TextRuntime;
    });

  const textGeneration = yield* makeAntigravityTextGeneration({ makeRuntime });
  const titleInput = { cwd: projectDirectory, message: "Repair Google login", modelSelection };
  const assertCleaned = Effect.gen(function* () {
    expect(state.closed).toEqual(state.workspaces);
    for (const workspace of state.workspaces) {
      expect(yield* fs.exists(workspace)).toBe(false);
    }
    expect(yield* fs.readFileString(path.join(projectDirectory, "keep.txt"))).toBe("untouched");
  });
  return {
    fs,
    path,
    projectDirectory,
    state,
    incoming,
    enteredPrompt,
    textGeneration,
    titleInput,
    assertCleaned,
  };
});

it.layer(NodeServices.layer)("AntigravityTextGeneration", (it) => {
  it.effect("generates all helper types in empty workspaces that go with the helper", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({
        outputs: [
          '{"subject":"  Repair Google login.\\nExtra line","body":"  Keep the remote callback.  ","branch":"Repair Login"}',
          '```json\n{"title":" Repair Google login\\nExtra line","body":"  ## Summary\\nSupport remote callbacks.  "}\n```',
          '{"branch":" Repair Google Login "}',
          '{"title":"  \\"Repair Google login\\"  "}',
        ],
      });
      const common = { cwd: fixture.projectDirectory, modelSelection };
      expect(
        yield* fixture.textGeneration.generateCommitMessage({
          ...common,
          branch: "feature/login",
          stagedSummary: "M login.ts",
          stagedPatch: "+handleRemoteCallback()",
          includeBranch: true,
        }),
      ).toEqual({
        subject: "Repair Google login",
        body: "Keep the remote callback.",
        branch: "feature/repair-login",
      });
      expect(
        yield* fixture.textGeneration.generatePrContent({
          ...common,
          baseBranch: "main",
          headBranch: "feature/login",
          commitSummary: "Repair login",
          diffSummary: "M login.ts",
          diffPatch: "+handleRemoteCallback()",
        }),
      ).toEqual({ title: "Repair Google login", body: "## Summary\nSupport remote callbacks." });
      expect(
        yield* fixture.textGeneration.generateBranchName({
          ...common,
          message: "Repair Google login",
        }),
      ).toEqual({ branch: "repair-google-login" });
      expect(yield* fixture.textGeneration.generateThreadTitle(fixture.titleInput)).toEqual({
        title: "Repair Google login",
      });
      expect(new Set(fixture.state.workspaces).size).toBe(4);
      expect(fixture.state.workspaces).not.toContain(fixture.projectDirectory);
      expect(fixture.state.selectedModes).toEqual(["default", "default", "default", "default"]);
      expect(fixture.state.selectedModels).toEqual(Array(4).fill(modelSelection.model));
      expect(fixture.state.prompts[0]?.prompt).toEqual([
        { type: "text", text: expect.stringContaining("+handleRemoteCallback()") },
      ]);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("proposes a crew like any other helper", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({
        outputs: [
          '{"lead":{"name":"Lead","part":"Plans it."},"builders":[{"name":"Checkout","part":"Builds it."}]}',
        ],
      });
      expect(
        yield* fixture.textGeneration.generateCrewProposal({
          cwd: fixture.projectDirectory,
          goal: "A tea shop that ships weekly.",
          modelSelection,
        }),
      ).toEqual({
        lead: { name: "Lead", part: "Plans it." },
        builders: [{ name: "Checkout", part: "Builds it." }],
      });
      expect(fixture.state.selectedModes).toEqual(["default"]);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect.each(["tool_call", "tool_call_update"] as const)(
    "aborts on %s even without a permission request",
    (sessionUpdate) =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          prompt: ({ emit }) =>
            emit({ sessionUpdate, toolCallId: "tool-1", title: "Read files" }).pipe(
              Effect.andThen(Effect.never),
            ),
        });
        const error = yield* fixture.textGeneration
          .generateThreadTitle(fixture.titleInput)
          .pipe(Effect.flip);
        expect(error.detail).toContain("tool work");
        expect(fixture.state.cancellations).toBe(1);
        yield* fixture.assertCleaned;
      }).pipe(Effect.scoped),
  );

  it.effect("rejects native permission and choice requests instead of answering them", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ prompt: () => Effect.never });
      const child = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.forkChild);
      yield* Deferred.await(fixture.enteredPrompt);
      const reply = yield* fixture.incoming.permission(
        {
          sessionId: SESSION_ID,
          toolCall: { toolCallId: "question-1", title: "Choose a title", kind: "other" },
          options: [
            { optionId: "first-native-choice", name: "Use this title", kind: "allow_once" },
            { optionId: "second-native-choice", name: "Use this title", kind: "allow_once" },
          ],
        },
        nativeRequestContext,
      );
      const error = yield* Fiber.join(child).pipe(Effect.flip);
      expect(reply).toEqual({ outcome: { outcome: "cancelled" } });
      expect(error.detail).toContain("permission or user input");
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("declines elicitation and stops the helper", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ prompt: () => Effect.never });
      const child = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.forkChild);
      yield* Deferred.await(fixture.enteredPrompt);
      const reply = yield* fixture.incoming.question(
        {
          sessionId: SESSION_ID,
          mode: "form",
          message: "Name this branch",
          requestedSchema: { type: "object", properties: {} },
        },
        nativeRequestContext,
      );
      const error = yield* Fiber.join(child).pipe(Effect.flip);
      expect(reply).toEqual({ action: "decline" });
      expect(error.detail).toContain("user input");
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect.each(["file", "terminal", "extension"] as const)(
    "denies unexpected %s requests",
    (kind) =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({ prompt: () => Effect.never });
        const child = yield* fixture.textGeneration
          .generateThreadTitle(fixture.titleInput)
          .pipe(Effect.forkChild);
        yield* Deferred.await(fixture.enteredPrompt);
        const request =
          kind === "file"
            ? fixture.incoming.readFile(
                { sessionId: SESSION_ID, path: "/not-allowed" },
                nativeRequestContext,
              )
            : kind === "terminal"
              ? fixture.incoming.createTerminal(
                  { sessionId: SESSION_ID, command: "not-allowed" },
                  nativeRequestContext,
                )
              : fixture.incoming.extension("_ask_user", {}, nativeRequestContext);
        const denied = yield* request.pipe(Effect.exit);
        expect(Exit.isFailure(denied)).toBe(true);
        const error = yield* Fiber.join(child).pipe(Effect.flip);
        expect(error.detail).toContain("tool or user input");
        yield* fixture.assertCleaned;
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    { output: "   ", detail: "empty" },
    { output: "No JSON here", detail: "invalid structured output" },
    { output: '{"title":42}', detail: "invalid structured output" },
    { output: "x".repeat(128_001), detail: "output limit" },
  ])("rejects $detail output and closes the runtime", ({ output, detail }) =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ outputs: [output] });
      const error = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.flip);
      expect(error.detail).toContain(detail);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("does not return partial JSON after native cancellation", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({
        prompt: ({ emit }) =>
          emit({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: '{"title":"Partial title"}' },
          }).pipe(Effect.as({ stopReason: "cancelled" })),
      });
      const error = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.flip);
      expect(error.detail).toContain("cancelled");
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a helper that writes files in its temporary workspace", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixture = yield* makeFixture({
        prompt: ({ cwd, emit }) =>
          Effect.gen(function* () {
            yield* fs
              .writeFileString(path.join(cwd, "unexpected.txt"), "unexpected")
              .pipe(Effect.orDie);
            yield* emit({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: '{"title":"Ignored output"}' },
            });
            return { stopReason: "end_turn" };
          }),
      });
      const error = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.flip);
      expect(error.detail).toContain("wrote files");
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("fails an unavailable model before prompting", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const error = yield* fixture.textGeneration
        .generateThreadTitle({
          ...fixture.titleInput,
          modelSelection: { ...modelSelection, model: "not-in-the-account" },
        })
        .pipe(Effect.flip);
      expect(error.detail).toContain("select the Antigravity model");
      expect(fixture.state.prompts).toEqual([]);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("uses the native default without sending T3's default selection as a model ID", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const result = yield* fixture.textGeneration.generateThreadTitle({
        ...fixture.titleInput,
        modelSelection: { ...modelSelection, model: ANTIGRAVITY_DEFAULT_MODEL },
      });
      expect(result).toEqual({ title: "Repair login" });
      expect(fixture.state.selectedModels).toEqual([]);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("does not start another runtime or prompt after authentication fails", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({
        startError: new AcpRequestError({ code: -32000, errorMessage: "Authentication required" }),
      });
      const error = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.flip);
      expect(error._tag).toBe("TextGenerationError");
      expect(fixture.state.workspaces).toHaveLength(1);
      expect(fixture.state.prompts).toEqual([]);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("times out a stalled helper and waits for cleanup", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ prompt: () => Effect.never });
      const child = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.forkChild);
      yield* Deferred.await(fixture.enteredPrompt);
      yield* TestClock.adjust(180_000);
      const error = yield* Fiber.join(child).pipe(Effect.flip);
      expect(error.detail).toContain("timed out");
      expect(fixture.state.cancellations).toBe(1);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );

  it.effect("closes all helper resources when stopped by caller", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ prompt: () => Effect.never });
      const child = yield* fixture.textGeneration
        .generateThreadTitle(fixture.titleInput)
        .pipe(Effect.forkChild);
      yield* Deferred.await(fixture.enteredPrompt);
      yield* Fiber.interrupt(child);
      expect(fixture.state.cancellations).toBe(1);
      yield* fixture.assertCleaned;
    }).pipe(Effect.scoped),
  );
});
