import { expect, it } from "@effect/vitest";
import { ProviderDriverKind, RuntimeRequestId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/compat";

import { makeAcpRequestOpenedEvent, makeAcpRequestResolvedEvent } from "./AcpCoreRuntimeEvents.ts";
import { mergeToolCallState, parseSessionUpdateEvent } from "./AcpRuntimeModel.ts";
import { sanitizeAcpStderrExcerpt } from "./AcpStderr.ts";
import {
  antigravityApprovalOptions,
  extractAntigravityUserInputQuestion,
  isAntigravityUserInputRequest,
  makeAntigravityUserInputResponse,
  normalizeAntigravitySessionUpdate,
  normalizeAntigravityToolCall,
  sanitizeAntigravityToolPayload,
  selectAntigravityPermissionOptionId,
} from "./AntigravityProtocol.ts";
import { applyCursorAcpModelSelection, buildCursorAcpSpawnInput } from "./CursorAcpSupport.ts";
import { applyGrokAcpModelSelection, grokAcpSpawnArgs } from "./GrokAcpSupport.ts";

const makeGrokRecordingRuntime = () => {
  const modelCalls: Array<{
    modelId: string;
    meta?: { readonly [key: string]: unknown } | null;
  }> = [];
  const runtime = {
    setSessionModel: (modelId: string, meta?: { readonly [key: string]: unknown } | null) =>
      Effect.sync(() => {
        modelCalls.push(meta === undefined ? { modelId } : { modelId, meta });
        return {};
      }),
    setModel: () => Effect.die("A v1 session never sets its model through a config option."),
  };
  return { runtime, modelCalls };
};

const permissionRequest = {
  sessionId: "session-1",
  toolCall: { toolCallId: "command-1", kind: "execute", title: "Run command" },
  options: [
    { optionId: "remember-this-command", name: "Allow always", kind: "allow_always" },
    { optionId: "run-this-time", name: "Allow", kind: "allow_once" },
    { optionId: "stop-this-command", name: "Deny", kind: "reject_once" },
  ],
} satisfies EffectAcpSchema.RequestPermissionRequest;

const questionRequest = {
  sessionId: "session-1",
  toolCall: {
    toolCallId: "interaction_9960062f",
    status: "pending",
    title: "Which result label should be used for the verification?",
    rawInput: {},
  },
  options: [
    { optionId: "1", name: "Verified", kind: "allow_once" },
    { optionId: "2", name: "Needs review", kind: "allow_once" },
  ],
} satisfies EffectAcpSchema.RequestPermissionRequest;

const commandStarted = {
  sessionId: "session-1",
  update: {
    sessionUpdate: "tool_call",
    toolCallId: "fc28d0af6ad14be8bbba20f4258d4d3e",
    title: "run_command",
    kind: "execute",
    status: "in_progress",
    rawInput: { CommandLine: "cat probe.txt", Cwd: "/workspace" },
  },
} satisfies EffectAcpSchema.SessionNotification;

const commandCompleted = {
  sessionId: "session-1",
  update: {
    toolCallId: commandStarted.update.toolCallId,
    status: "completed",
    rawOutput: {
      commandLine: "cat probe.txt",
      workingDir: "/workspace",
      exitCode: 0,
      exit_code: 0,
      combinedOutput: "after\n",
      formatted_output: "after\n",
    },
    sessionUpdate: "tool_call_update",
  },
} satisfies EffectAcpSchema.SessionNotification;

const imageNotification = {
  sessionId: "session-1",
  update: {
    sessionUpdate: "tool_call_update",
    toolCallId: "image-1",
    status: "completed",
    rawOutput: { imageName: "result", imagePath: "file:///workspace/brain/result%20image.png" },
    content: [
      {
        type: "content",
        content: {
          type: "image",
          mimeType: "image/png",
          data: "inline-image-bytes".repeat(50_000),
        },
      },
      { type: "content", content: { type: "text", text: "Saved the image." } },
      { type: "diff", path: "/workspace/note.txt", oldText: "old", newText: "new" },
    ],
  },
} satisfies EffectAcpSchema.SessionNotification;

const commandPermissionRequest = {
  kind: "execute" as const,
  detail: "cat package.json",
  toolCall: {
    toolCallId: "tool-1",
    kind: "execute",
    status: "pending" as const,
    command: "cat package.json",
    detail: "cat package.json",
    data: { toolCallId: "tool-1", kind: "execute" },
  },
};

function parseToolUpdate(notification: EffectAcpSchema.SessionNotification) {
  const result = parseSessionUpdateEvent(normalizeAntigravitySessionUpdate(notification));
  const event = result.events[0];
  if (event?._tag !== "ToolCallUpdated") {
    throw new Error("Expected a tool update.");
  }
  return event;
}

// witness: apps/server/src/provider/acp/AcpStderr.ts | sk-[A-Za-z0-9][A-Za-z0-9_-]{7,} → sk-[A-Za-z0-9]{8,}
it("AP1: A provider's stderr excerpt shown on an error replaces the home directory with `~` and hides pairing links, bearer, basic and x-api-key credentials and secret keys, hyphenated project, service and Anthropic keys included", () => {
  const excerpt = sanitizeAcpStderrExcerpt(
    [
      "Invalid project config at /Users/ada/.cursor/cli.json",
      "Authorization: Bearer secret-token-value",
      "Visit http://localhost:5733/pair#token=ABCDEF for pairing",
      "key=sk-abcdefghijklmnopqrstuv",
    ].join("\n"),
    { HOME: "/Users/ada" },
  );
  expect(excerpt).toContain("Invalid project config at ~/.cursor/cli.json");
  expect(excerpt).toContain("Bearer [redacted]");
  expect(excerpt).toContain("[pairing-url]");
  expect(excerpt).toContain("[redacted]");
  expect(excerpt).not.toContain("secret-token-value");
  expect(excerpt).not.toContain("ABCDEF");
  expect(excerpt).not.toContain("sk-abcdefghijklmnopqrstuv");

  const hyphenated = sanitizeAcpStderrExcerpt(
    [
      "openai=sk-proj-abcdefghijklmnopqrstuvwxyz012345",
      "svc=sk-svcacct-abcdefghijklmnopqrstuvwxyz012345",
      "anthropic=sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
      "Authorization: Basic dXNlcjpwYXNz",
      "x-api-key: ant-api-key-value",
    ].join("\n"),
  );
  expect(hyphenated).toContain("[redacted]");
  expect(hyphenated).toContain("Authorization: Basic [redacted]");
  expect(hyphenated).toContain("x-api-key: [redacted]");
  expect(hyphenated).not.toContain("sk-proj-");
  expect(hyphenated).not.toContain("sk-svcacct-");
  expect(hyphenated).not.toContain("sk-ant-api03-");
  expect(hyphenated).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  expect(hyphenated).not.toContain("dXNlcjpwYXNz");
  expect(hyphenated).not.toContain("ant-api-key-value");
});

// witness: apps/server/src/provider/acp/CursorAcpSupport.ts | return ["--auto-review"]; → return ["--force"];
it("AP2: Cursor starts with `--force` only under full access and with `--auto-review` only under auto; supervised and auto-accept-edits start it with neither", () => {
  expect(buildCursorAcpSpawnInput(undefined, "/tmp/project", undefined, "full-access")).toEqual({
    command: "cursor-agent",
    args: ["--force", "acp"],
    cwd: "/tmp/project",
  });
  expect(buildCursorAcpSpawnInput(undefined, "/tmp/project", undefined, "auto")).toEqual({
    command: "cursor-agent",
    args: ["--auto-review", "acp"],
    cwd: "/tmp/project",
  });
  for (const runtimeMode of ["approval-required", "auto-accept-edits"] as const) {
    expect(buildCursorAcpSpawnInput(undefined, "/tmp/project", undefined, runtimeMode)).toEqual({
      command: "cursor-agent",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  }
});

// witness: apps/server/src/provider/acp/CursorAcpSupport.ts | yield* input.runtime.setModel(resolveCursorAcpBaseModelId(input.model)).pipe( → yield* input.runtime.setModel(input.model ?? "").pipe(
it.effect(
  "AP3: Cursor's model selection sets the base model id, without its bracketed parameters, before any option, then each chosen option under Cursor's own option id and value",
  () =>
    Effect.gen(function* () {
      const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "gpt-5.4-medium-fast",
          options: [{ value: "gpt-5.4-medium-fast", name: "GPT-5.4" }],
        },
        {
          id: "reasoning",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue: "medium",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
            { value: "extra-high", name: "Extra High" },
          ],
        },
        {
          id: "context",
          name: "Context",
          category: "model_config",
          type: "select",
          currentValue: "272k",
          options: [
            { value: "272k", name: "272K" },
            { value: "1m", name: "1M" },
          ],
        },
        {
          id: "fast",
          name: "Fast",
          category: "model_config",
          type: "select",
          currentValue: "false",
          options: [
            { value: "false", name: "Off" },
            { value: "true", name: "Fast" },
          ],
        },
      ];
      const calls: Array<
        | { readonly type: "model"; readonly value: string }
        | { readonly type: "config"; readonly configId: string; readonly value: string | boolean }
      > = [];
      const runtime = {
        getConfigOptions: Effect.succeed(configOptions),
        setModel: (value: string) =>
          Effect.sync(() => {
            calls.push({ type: "model", value });
          }),
        setConfigOption: (configId: string, value: string | boolean) =>
          Effect.sync(() => {
            calls.push({ type: "config", configId, value });
          }),
      };

      yield* applyCursorAcpModelSelection({
        runtime,
        model: "gpt-5.4-medium-fast[reasoning=medium,context=272k]",
        selections: [
          { id: "reasoning", value: "xhigh" },
          { id: "contextWindow", value: "1m" },
          { id: "fastMode", value: true },
        ],
        mapError: ({ step, configId, cause }) =>
          step === "set-config-option"
            ? `failed to set config option ${configId}: ${cause.message}`
            : `failed to set model: ${cause.message}`,
      });

      expect(calls).toEqual([
        { type: "model", value: "gpt-5.4-medium-fast" },
        { type: "config", configId: "reasoning", value: "extra-high" },
        { type: "config", configId: "context", value: "1m" },
        { type: "config", configId: "fast", value: "true" },
      ]);
    }),
);

// witness: apps/server/src/provider/acp/GrokAcpSupport.ts | return ["--permission-mode", "default", "agent", "stdio"]; → return ["agent", "stdio"];
it("AP4: Grok starts in its ask mode under supervised, accept-edits under auto-accept-edits, auto under auto and always-approve only under full access, the mode on the argv so a config file cannot override it, and with no mode it inherits its own config", () => {
  expect(grokAcpSpawnArgs()).toEqual(["agent", "stdio"]);
  expect(grokAcpSpawnArgs("approval-required")).toEqual([
    "--permission-mode",
    "default",
    "agent",
    "stdio",
  ]);
  expect(grokAcpSpawnArgs("full-access")).toEqual(["agent", "--always-approve", "stdio"]);
  expect(grokAcpSpawnArgs("auto-accept-edits")).toEqual([
    "--permission-mode",
    "acceptEdits",
    "agent",
    "stdio",
  ]);
  expect(grokAcpSpawnArgs("auto")).toEqual(["--permission-mode", "auto", "agent", "stdio"]);
});

// witness: apps/server/src/provider/acp/GrokAcpSupport.ts | input.requestedModelId === GROK_DEFAULT_MODEL_SLUG ? undefined : input.requestedModelId; → input.requestedModelId;
it.effect(
  "AP5: A Grok model selection switches the session's model only when another model is asked for, and never sends the product slug `grok-build`, which keeps the session's current model",
  () =>
    Effect.gen(function* () {
      const differs = makeGrokRecordingRuntime();
      expect(
        yield* applyGrokAcpModelSelection({
          selectsModelByConfigOption: false,
          runtime: differs.runtime,
          currentModelId: "grok-build",
          requestedModelId: "grok-mock-alt",
          mapError: (cause) => cause.message,
        }),
      ).toBe("grok-mock-alt");
      expect(differs.modelCalls).toEqual([{ modelId: "grok-mock-alt" }]);

      const matches = makeGrokRecordingRuntime();
      expect(
        yield* applyGrokAcpModelSelection({
          selectsModelByConfigOption: false,
          runtime: matches.runtime,
          currentModelId: "grok-build",
          requestedModelId: "grok-build",
          mapError: (cause) => cause.message,
        }),
      ).toBe("grok-build");
      expect(matches.modelCalls).toEqual([]);

      const productSlug = makeGrokRecordingRuntime();
      expect(
        yield* applyGrokAcpModelSelection({
          selectsModelByConfigOption: false,
          runtime: productSlug.runtime,
          currentModelId: "grok-4.6",
          requestedModelId: "grok-build",
          mapError: (cause) => cause.message,
        }),
      ).toBe("grok-4.6");
      expect(productSlug.modelCalls).toEqual([]);

      const none = makeGrokRecordingRuntime();
      expect(
        yield* applyGrokAcpModelSelection({
          selectsModelByConfigOption: false,
          runtime: none.runtime,
          currentModelId: "grok-build",
          requestedModelId: undefined,
          mapError: (cause) => cause.message,
        }),
      ).toBe("grok-build");
      expect(none.modelCalls).toEqual([]);
    }),
);

// witness: apps/server/src/provider/acp/GrokAcpSupport.ts | reasoningProvided && reasoningEffort !== input.currentReasoningEffort; → reasoningEffort !== input.currentReasoningEffort;
it.effect(
  "AP6: A Grok selection carries a reasoning effort only when one was asked for and is a valid token, and a selection that omits the effort never clears the current one",
  () =>
    Effect.gen(function* () {
      const asked = makeGrokRecordingRuntime();
      expect(
        yield* applyGrokAcpModelSelection({
          selectsModelByConfigOption: false,
          runtime: asked.runtime,
          currentModelId: "grok-4.6",
          currentReasoningEffort: "high",
          requestedModelId: "grok-4.6",
          requestedReasoningEffort: "xhigh",
          mapError: (cause) => cause.message,
        }),
      ).toBe("grok-4.6");
      expect(asked.modelCalls).toEqual([
        { modelId: "grok-4.6", meta: { reasoningEffort: "xhigh" } },
      ]);

      const omitted = makeGrokRecordingRuntime();
      expect(
        yield* applyGrokAcpModelSelection({
          selectsModelByConfigOption: false,
          runtime: omitted.runtime,
          currentModelId: "grok-4.6",
          currentReasoningEffort: "high",
          requestedModelId: "grok-4.6",
          requestedReasoningEffort: undefined,
          mapError: (cause) => cause.message,
        }),
      ).toBe("grok-4.6");
      expect(omitted.modelCalls).toEqual([]);

      const malformed = makeGrokRecordingRuntime();
      yield* applyGrokAcpModelSelection({
        selectsModelByConfigOption: false,
        runtime: malformed.runtime,
        currentModelId: "grok-4.6",
        currentReasoningEffort: "high",
        requestedModelId: "grok-4.6",
        requestedReasoningEffort: "not a token",
        mapError: (cause) => cause.message,
      });
      expect(malformed.modelCalls).toEqual([{ modelId: "grok-4.6" }]);

      const productSlug = makeGrokRecordingRuntime();
      expect(
        yield* applyGrokAcpModelSelection({
          selectsModelByConfigOption: false,
          runtime: productSlug.runtime,
          currentModelId: "grok-4.6",
          currentReasoningEffort: "high",
          requestedModelId: "grok-build",
          requestedReasoningEffort: "xhigh",
          mapError: (cause) => cause.message,
        }),
      ).toBe("grok-4.6");
      expect(productSlug.modelCalls).toEqual([
        { modelId: "grok-4.6", meta: { reasoningEffort: "xhigh" } },
      ]);
    }),
);

// witness: apps/server/src/provider/acp/AcpCoreRuntimeEvents.ts | return "exec_command_approval"; → return "dynamic_tool_call";
it("AP7: An ACP permission request for a command opens and resolves as a command approval, one for an edit as a file-change approval, and one of any other kind, a future kind included, as a generic tool approval", () => {
  const stamp = { eventId: "event-1" as never, createdAt: "2026-03-27T00:00:00.000Z" };
  const command = {
    stamp,
    provider: ProviderDriverKind.make("cursor"),
    threadId: "thread-1" as never,
    turnId: TurnId.make("turn-1"),
    requestId: RuntimeRequestId.make("request-1"),
    permissionRequest: commandPermissionRequest,
  };
  expect(
    makeAcpRequestOpenedEvent({
      ...command,
      detail: "cat package.json",
      args: { command: ["cat", "package.json"] },
      source: "acp.jsonrpc",
      method: "session/request_permission",
      rawPayload: { sessionId: "session-1" },
    }),
  ).toMatchObject({ type: "request.opened", payload: { requestType: "exec_command_approval" } });
  expect(makeAcpRequestResolvedEvent({ ...command, decision: "accept" })).toMatchObject({
    type: "request.resolved",
    payload: { requestType: "exec_command_approval" },
  });

  expect(
    makeAcpRequestOpenedEvent({
      stamp: { eventId: "approval-1" as never, createdAt: "2026-09-02T00:00:00.000Z" },
      provider: ProviderDriverKind.make("antigravity"),
      threadId: "thread-1" as never,
      turnId: TurnId.make("turn-1"),
      requestId: RuntimeRequestId.make("request-1"),
      permissionRequest: { kind: "edit" },
      approvalOptions: [
        { decision: "accept", label: "Allow once" },
        { decision: "decline", label: "Reject" },
      ],
      detail: "Edit package.json",
      args: {},
      source: "acp.jsonrpc",
      method: "session/request_permission",
      rawPayload: { sessionId: "session-1" },
    }),
  ).toMatchObject({ type: "request.opened", payload: { requestType: "file_change_approval" } });

  for (const kind of ["search", "fetch", "other", "unknown", "future-tool-kind"]) {
    const request = {
      stamp,
      provider: ProviderDriverKind.make("cursor"),
      threadId: "thread-1" as never,
      turnId: TurnId.make("turn-1"),
      requestId: RuntimeRequestId.make(`request-${kind}`),
      permissionRequest: { kind },
    };
    expect(
      makeAcpRequestOpenedEvent({
        ...request,
        detail: kind,
        args: {},
        source: "acp.jsonrpc",
        method: "session/request_permission",
        rawPayload: { sessionId: "session-1" },
      }),
    ).toMatchObject({ type: "request.opened", payload: { requestType: "dynamic_tool_call" } });
    expect(makeAcpRequestResolvedEvent({ ...request, decision: "accept" })).toMatchObject({
      type: "request.resolved",
      payload: { requestType: "dynamic_tool_call" },
    });
  }
});

// witness: apps/server/src/provider/acp/AcpCoreRuntimeEvents.ts | ...(input.approvalOptions !== undefined ? { options: input.approvalOptions } : {}), → options: input.approvalOptions ?? [],
it("AP8: An ACP approval offers exactly the choices the provider sent, without a remembered-allow added, and a request that sent none carries no choices", () => {
  const offered = makeAcpRequestOpenedEvent({
    stamp: { eventId: "approval-1" as never, createdAt: "2026-09-02T00:00:00.000Z" },
    provider: ProviderDriverKind.make("antigravity"),
    threadId: "thread-1" as never,
    turnId: TurnId.make("turn-1"),
    requestId: RuntimeRequestId.make("request-1"),
    permissionRequest: { kind: "edit" },
    approvalOptions: [
      { decision: "accept", label: "Allow once" },
      { decision: "decline", label: "Reject" },
    ],
    detail: "Edit package.json",
    args: {},
    source: "acp.jsonrpc",
    method: "session/request_permission",
    rawPayload: { sessionId: "session-1" },
  });
  expect(offered).toHaveProperty("payload.options", [
    { decision: "accept", label: "Allow once" },
    { decision: "decline", label: "Reject" },
  ]);

  const none = makeAcpRequestOpenedEvent({
    stamp: { eventId: "event-1" as never, createdAt: "2026-03-27T00:00:00.000Z" },
    provider: ProviderDriverKind.make("cursor"),
    threadId: "thread-1" as never,
    turnId: TurnId.make("turn-1"),
    requestId: RuntimeRequestId.make("request-1"),
    permissionRequest: commandPermissionRequest,
    detail: "cat package.json",
    args: { command: ["cat", "package.json"] },
    source: "acp.jsonrpc",
    method: "session/request_permission",
    rawPayload: { sessionId: "session-1" },
  });
  expect(none).not.toHaveProperty("payload.options");
});

// witness: apps/server/src/provider/acp/AntigravityProtocol.ts | return option?.optionId.trim() ? option.optionId : undefined; → return option?.optionId ?? request.options[0]?.optionId;
it("AP9: An Antigravity approval answers only with an option the agent offered, allow-once for accept, allow-always for this thread or always, reject-once for decline and nothing for cancel, and nothing at all when the matching kind is missing", () => {
  expect(selectAntigravityPermissionOptionId(permissionRequest, "accept")).toBe("run-this-time");
  expect(selectAntigravityPermissionOptionId(permissionRequest, "acceptForSession")).toBe(
    "remember-this-command",
  );
  expect(selectAntigravityPermissionOptionId(permissionRequest, "acceptAlways")).toBe(
    "remember-this-command",
  );
  expect(selectAntigravityPermissionOptionId(permissionRequest, "decline")).toBe(
    "stop-this-command",
  );
  expect(selectAntigravityPermissionOptionId(permissionRequest, "cancel")).toBeUndefined();

  const withoutAlways = {
    ...permissionRequest,
    options: permissionRequest.options.filter((option) => option.kind !== "allow_always"),
  };
  expect(selectAntigravityPermissionOptionId(withoutAlways, "acceptAlways")).toBeUndefined();
  expect(selectAntigravityPermissionOptionId(withoutAlways, "acceptForSession")).toBeUndefined();
  expect(selectAntigravityPermissionOptionId(withoutAlways, "accept")).toBe("run-this-time");
  expect(
    selectAntigravityPermissionOptionId({ ...withoutAlways, options: [] }, "decline"),
  ).toBeUndefined();
});

// witness: apps/server/src/provider/acp/AntigravityProtocol.ts | const text = warning?.message?.trim() || warning?.title?.trim(); → const text = warning?.title?.trim();
it("AP10: Antigravity offers a person only the decisions the request can honor, then Cancel, and shows the agent's prompt-injection warning text on the remembered approval", () => {
  const risky = {
    ...permissionRequest,
    options: [
      {
        optionId: "remember-this-command",
        name: "Allow Always (risky)",
        kind: "allow_always",
        _meta: {
          "agy.security.warning": {
            severity: "high",
            risk: "prompt_injection",
            title: "Allowing always can be risky",
            message: "Untrusted files could re-run this action without asking.",
          },
        },
      },
      { optionId: "run-this-time", name: "Allow", kind: "allow_once" },
      { optionId: "stop-this-command", name: "Deny", kind: "reject_once" },
    ],
  } satisfies EffectAcpSchema.RequestPermissionRequest;
  expect(antigravityApprovalOptions(risky)).toEqual([
    { decision: "accept", label: "Allow once" },
    {
      decision: "acceptForSession",
      label: "Allow for this thread",
      warning: "Untrusted files could re-run this action without asking.",
    },
    { decision: "decline", label: "Deny" },
    { decision: "cancel", label: "Cancel" },
  ]);
  expect(antigravityApprovalOptions(permissionRequest)[1]).not.toHaveProperty("warning");
});

// witness: apps/server/src/provider/acp/AntigravityProtocol.ts | const option = matchingLabels.length === 1 ? matchingLabels[0] : undefined; → const option = matchingLabels[0];
it("AP11: A native Antigravity question reaches the person as a single-choice question, never as an approval, and the answer goes back as the chosen option's exact id, a reject-labelled choice included, or by its label only when exactly one option bears it", () => {
  expect(isAntigravityUserInputRequest(questionRequest)).toBe(true);
  expect(selectAntigravityPermissionOptionId(questionRequest, "accept")).toBeUndefined();
  expect(extractAntigravityUserInputQuestion(questionRequest)).toEqual({
    id: "interaction_9960062f",
    header: "Question",
    question: "Which result label should be used for the verification?",
    multiSelect: false,
    allowCustomAnswer: false,
    options: [
      { value: "1", label: "Verified", description: "Verified" },
      { value: "2", label: "Needs review", description: "Needs review" },
    ],
  });
  expect(extractAntigravityUserInputQuestion(permissionRequest)).toBeUndefined();

  for (const answer of ["1", ["1"], "Verified"]) {
    expect(
      makeAntigravityUserInputResponse(questionRequest, { interaction_9960062f: answer }),
    ).toEqual({ outcome: { outcome: "selected", optionId: "1" } });
  }
  const opaque = {
    ...questionRequest,
    options: [{ optionId: " choice: opaque ", name: "Keep", kind: "allow_once" as const }],
  };
  expect(
    makeAntigravityUserInputResponse(opaque, { interaction_9960062f: " choice: opaque " }),
  ).toEqual({ outcome: { outcome: "selected", optionId: " choice: opaque " } });

  const reject = {
    ...questionRequest,
    options: [{ optionId: "deny", name: "Do not trust", kind: "reject_once" as const }],
  };
  expect(makeAntigravityUserInputResponse(reject, { interaction_9960062f: "deny" })).toEqual({
    outcome: { outcome: "selected", optionId: "deny" },
  });

  const sameLabels = {
    ...questionRequest,
    options: questionRequest.options.map((option) => ({ ...option, name: "Same label" })),
  };
  expect(
    extractAntigravityUserInputQuestion(sameLabels)?.options.map((option) => option.value),
  ).toEqual(["1", "2"]);
  expect(
    makeAntigravityUserInputResponse(sameLabels, { interaction_9960062f: "Same label" }),
  ).toBeUndefined();
  expect(makeAntigravityUserInputResponse(sameLabels, { interaction_9960062f: "2" })).toEqual({
    outcome: { outcome: "selected", optionId: "2" },
  });
});

// witness: apps/server/src/provider/acp/AntigravityProtocol.ts | if (!option.optionId.trim() || ids.has(option.optionId)) { → if (!option.optionId.trim()) {
it("AP12: An unusable answer to a native question (empty, free text, several choices, another shape) or a question with a missing or duplicate option id sends nothing and keeps the question open", () => {
  for (const answer of [
    undefined,
    null,
    "",
    "arbitrary answer",
    [],
    ["1", "2"],
    { answer: "1" },
    1,
  ]) {
    expect(
      makeAntigravityUserInputResponse(questionRequest, { interaction_9960062f: answer }),
    ).toBeUndefined();
  }
  for (const optionId of ["", "1"]) {
    const request = {
      ...questionRequest,
      options: [questionRequest.options[0]!, { ...questionRequest.options[1]!, optionId }],
    };
    expect(extractAntigravityUserInputQuestion(request)).toBeUndefined();
    expect(
      makeAntigravityUserInputResponse(request, { interaction_9960062f: "1" }),
    ).toBeUndefined();
  }
});

// witness: apps/server/src/provider/acp/AntigravityProtocol.ts | input?.WorkingDirectory ?? → input?.Cwd ??
it("AP13: A captured Antigravity command shows its command line, working directory, output and exit code under every native field name, and a nonzero exit stays a completed command, not a tool failure", () => {
  const initial = parseToolUpdate(commandStarted).toolCall;
  const completed = parseToolUpdate(commandCompleted).toolCall;
  expect(normalizeAntigravityToolCall(mergeToolCallState(initial, completed))).toMatchObject({
    kind: "execute",
    status: "completed",
    command: "cat probe.txt",
    detail: "cat probe.txt",
    data: {
      command: "cat probe.txt",
      cwd: "/workspace",
      item: {
        command: "cat probe.txt",
        cwd: "/workspace",
        aggregatedOutput: "after\n",
        exitCode: 0,
      },
    },
  });

  for (const rawInput of [
    { CommandLine: "pwd", Cwd: "/one" },
    { CommandLine: "pwd", WorkingDirectory: "/one" },
    { command_line: "pwd", working_dir: "/one" },
    { commandLine: "pwd", workingDir: "/one" },
    { command: "pwd", cwd: "/one" },
  ]) {
    const event = parseToolUpdate({
      ...commandStarted,
      update: { ...commandStarted.update, rawInput },
    });
    expect(normalizeAntigravityToolCall(event.toolCall)).toMatchObject({
      command: "pwd",
      detail: "pwd",
      data: { item: { command: "pwd", cwd: "/one" } },
    });
  }

  const history = parseToolUpdate({
    ...commandCompleted,
    update: {
      ...commandCompleted.update,
      rawOutput: {
        command_line: "test -f missing.txt",
        working_dir: "/workspace",
        combined_output: "",
        exit_code: 1,
      },
    },
  });
  expect(normalizeAntigravityToolCall(history.toolCall)).toMatchObject({
    kind: "execute",
    status: "completed",
    command: "test -f missing.txt",
    data: { item: { cwd: "/workspace", aggregatedOutput: "", exitCode: 1 } },
  });
});

// witness: apps/server/src/provider/acp/AntigravityProtocol.ts | if (/^data:image\//i.test(value) || budget.text <= 0) { → if (budget.text <= 0) {
it("AP14: Antigravity tool output reaching the conversation stays bounded and keeps its end, and no inline image bytes, image blob or image data URL reaches it, while the rest of the tool's content stays", () => {
  const output = `${"output line\n".repeat(20_000)}last line\n`;
  const event = parseToolUpdate({
    ...commandCompleted,
    update: {
      ...commandCompleted.update,
      rawOutput: {
        ...commandCompleted.update.rawOutput,
        combinedOutput: output,
        formatted_output: output,
      },
    },
  });
  const toolCall = normalizeAntigravityToolCall(event.toolCall);
  expect(toolCall.data).toMatchObject({
    item: { aggregatedOutput: expect.stringContaining("last line\n") },
    rawOutput: { combinedOutput: expect.stringContaining("last line\n") },
  });
  expect(JSON.stringify(toolCall).length).toBeLessThan(20_000);
  expect(JSON.stringify(event.rawPayload).length).toBeLessThan(10_000);
  expect(JSON.stringify(event.rawPayload)).not.toContain("formatted_output");

  const normalized = normalizeAntigravitySessionUpdate(imageNotification);
  expect(JSON.stringify(normalized)).not.toContain("inline-image-bytes");
  expect(normalized.update).toMatchObject({
    content: [
      { type: "content", content: { type: "text", text: "Saved the image." } },
      { type: "diff", path: "/workspace/note.txt", oldText: "old", newText: "new" },
    ],
  });

  const serialized = JSON.stringify(
    sanitizeAntigravityToolPayload({
      rawOutput: {
        text: "a".repeat(100_000),
        result: { mimeType: "image/png", blob: "image-blob".repeat(100_000) },
        image: { type: "image", data: "inline-image".repeat(100_000) },
        uri: "data:image/png;base64,inline-data-url",
      },
    }),
  );
  expect(serialized.length).toBeLessThan(9_000);
  expect(serialized).not.toContain("image-blob");
  expect(serialized).not.toContain("inline-image");
  expect(serialized).not.toContain("inline-data-url");
});

// witness: apps/server/src/provider/acp/AntigravityProtocol.ts | return /^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path) ? undefined : path; → return path;
it("AP15: Only a local image path (a workspace path, a Windows path or a local file URL) becomes a tool's image, never a web address, another host's file URL or a data URL", () => {
  for (const [imagePath, expected] of [
    ["/workspace/result.png", "/workspace/result.png"],
    ["C:\\work\\result.png", "C:\\work\\result.png"],
    ["file:///C:/work/result.png", "C:/work/result.png"],
    ["https://example.com/result.png", undefined],
    ["file://another-host/result.png", undefined],
    ["data:image/png;base64,AAAA", undefined],
  ] as const) {
    const toolCall = normalizeAntigravityToolCall({
      toolCallId: "image-1",
      data: { rawOutput: { imagePath } },
    });
    expect(toolCall.data.imagePath).toBe(expected);
  }

  expect(
    normalizeAntigravityToolCall(
      parseToolUpdate(normalizeAntigravitySessionUpdate(imageNotification)).toolCall,
    ).data.imagePath,
  ).toBe("/workspace/brain/result image.png");
});
