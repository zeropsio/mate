/**
 * The thread tool policy SPI against the real Codex adapter and session
 * runtime: what a thread with a profile writes to Codex, and how its
 * approval requests are answered, compared with the same session without
 * one. The app-server is the harness's scripted peer; what a live Codex does
 * with these messages is probe 25's.
 */
import { assert, describe, it } from "@effect/vitest";
import {
  type ModelSelection,
  ProviderDriverKind,
  type ProviderSessionStartInput,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  codexAdapterHarnessLayer,
  makeCodexAdapterHarness,
  PEER_THREAD_ID,
  PEER_TURN_ID,
  type PeerMessage,
  type WireRecord,
} from "./codexAdapterHarness.ts";
import { type ThreadToolProfile, ThreadToolPolicyRegistry } from "./threadToolPolicy.ts";

const CREW_THREAD = ThreadId.make("crew-thread");
const PERSON_THREAD = ThreadId.make("person-thread");
const CWD = "/var/www/.crew/backend";
const INSTANCE_ID = ProviderInstanceId.make("codex");

type ToolCall = Parameters<ThreadToolProfile["decideTool"]>[0];

const PROFILE: ThreadToolProfile = {
  sessionContext: "You are @backend on the crew.",
  contextWindow: 200_000,
  decideTool: () => Effect.succeed({ kind: "allow" }),
  tools: [],
};

const startInput = (
  overrides: Partial<ProviderSessionStartInput> = {},
): ProviderSessionStartInput => ({
  threadId: CREW_THREAD,
  provider: ProviderDriverKind.make("codex"),
  runtimeMode: "full-access",
  cwd: CWD,
  ...overrides,
});

/** One adapter with the profile installed for CREW_THREAD only. */
const withProfile = (
  profile: ThreadToolProfile,
  turns: ReadonlyArray<ReadonlyArray<PeerMessage>> = [],
) =>
  Effect.gen(function* () {
    yield* (yield* ThreadToolPolicyRegistry).install({
      profileFor: ({ threadId }) => Effect.succeed(threadId === CREW_THREAD ? profile : undefined),
    });
    return yield* makeCodexAdapterHarness({ turns });
  });

const contractLayer = Layer.merge(codexAdapterHarnessLayer, ThreadToolPolicyRegistry.layer);

const paramsOf = (wire: ReadonlyArray<WireRecord>, method: string) =>
  wire.flatMap((record) =>
    "method" in record && record.method === method
      ? [record.params as Record<string, unknown>]
      : [],
  );

/** Keys whose value differs between two param objects. */
const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();

const THREAD_OVERRIDES = {
  approvalPolicy: "untrusted",
  approvalsReviewer: "user",
  sandbox: "workspace-write",
  developerInstructions: PROFILE.sessionContext,
  config: {
    "mcp_servers.zerops.enabled": false,
    model_auto_compact_token_limit: PROFILE.contextWindow,
  },
};

describe("a thread with a tool profile, on the Codex adapter", () => {
  it.effect(
    "starts untrusted, with zcp's MCP server off and its context as developer instructions",
    () =>
      Effect.gen(function* () {
        const crew = yield* withProfile(PROFILE);
        yield* crew.adapter.startSession(startInput());
        const person = yield* makeCodexAdapterHarness();
        yield* person.adapter.startSession(startInput({ threadId: PERSON_THREAD }));
        const [crewStart] = paramsOf(crew.wire, "thread/start");
        const [personStart] = paramsOf(person.wire, "thread/start");
        assert.deepStrictEqual(changedKeys(personStart!, crewStart!), [
          "approvalPolicy",
          "config",
          "developerInstructions",
          "sandbox",
        ]);
        assert.deepInclude(crewStart, THREAD_OVERRIDES);
        assert.deepStrictEqual(crew.spawns, person.spawns, "the app-server argv changed");
      }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("runs a read-only thread in the read-only sandbox, on start and every turn", () =>
    Effect.gen(function* () {
      const { adapter, wire } = yield* withProfile({ ...PROFILE, readOnly: true });
      yield* adapter.startSession(startInput());
      yield* adapter.sendTurn({ threadId: CREW_THREAD, input: "read", attachments: [] });
      const [start] = paramsOf(wire, "thread/start");
      assert.deepInclude(start, { ...THREAD_OVERRIDES, sandbox: "read-only" });
      const [turn] = paramsOf(wire, "turn/start");
      assert.deepInclude(turn, { sandboxPolicy: { type: "readOnly" } });
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("resumes with the same overrides", () =>
    Effect.gen(function* () {
      const { adapter, wire } = yield* withProfile(PROFILE);
      yield* adapter.startSession(startInput({ resumeCursor: { threadId: PEER_THREAD_ID } }));
      const [resume] = paramsOf(wire, "thread/resume");
      assert.deepInclude(resume, { threadId: PEER_THREAD_ID, ...THREAD_OVERRIDES });
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("keeps every turn untrusted, whatever the thread's runtime mode", () =>
    Effect.gen(function* () {
      const { adapter, wire } = yield* withProfile(PROFILE);
      yield* adapter.startSession(startInput());
      for (const interactionMode of ["default", "plan"] as const) {
        yield* adapter.sendTurn({
          threadId: CREW_THREAD,
          input: "work",
          attachments: [],
          interactionMode,
        });
      }
      for (const turn of paramsOf(wire, "turn/start")) {
        assert.deepInclude(turn, {
          approvalPolicy: "untrusted",
          approvalsReviewer: "user",
          sandboxPolicy: { type: "workspaceWrite" },
        });
      }
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("runs the profile's model and effort over the thread's, on start and every turn", () =>
    Effect.gen(function* () {
      const threadSelection: ModelSelection = {
        instanceId: INSTANCE_ID,
        model: "gpt-5.6-sol",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      };
      const { adapter, wire } = yield* withProfile({
        ...PROFILE,
        model: "gpt-5.6-luna",
        effort: "low",
      });
      yield* adapter.startSession(startInput({ modelSelection: threadSelection }));
      yield* adapter.sendTurn({
        threadId: CREW_THREAD,
        input: "work",
        attachments: [],
        modelSelection: threadSelection,
      });
      const [start] = paramsOf(wire, "thread/start");
      assert.deepInclude(start, { model: "gpt-5.6-luna", serviceTier: "fast" });
      const [turn] = paramsOf(wire, "turn/start");
      assert.deepInclude(turn, { model: "gpt-5.6-luna", effort: "low", serviceTier: "fast" });
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );
});

const FILE_CHANGE_ITEM = "call_patch_1";

const turnMessages: ReadonlyArray<PeerMessage> = [
  {
    notification: "item/started",
    params: {
      threadId: PEER_THREAD_ID,
      turnId: PEER_TURN_ID,
      startedAtMs: 1,
      item: {
        type: "fileChange",
        id: FILE_CHANGE_ITEM,
        changes: [
          { path: "src/login.ts", kind: { type: "update", move_path: null }, diff: "" },
          { path: `${CWD}/src/login.test.ts`, kind: { type: "add" }, diff: "" },
        ],
        status: "inProgress",
      },
    },
  },
  {
    request: "item/fileChange/requestApproval",
    params: {
      threadId: PEER_THREAD_ID,
      turnId: PEER_TURN_ID,
      itemId: FILE_CHANGE_ITEM,
      startedAtMs: 1,
    },
  },
  {
    request: "item/commandExecution/requestApproval",
    params: {
      threadId: PEER_THREAD_ID,
      turnId: PEER_TURN_ID,
      itemId: "call_exec_1",
      command: "cat /home/zerops/.codex/auth.json",
      cwd: CWD,
      startedAtMs: 2,
    },
  },
  {
    request: "item/permissions/requestApproval",
    params: {
      threadId: PEER_THREAD_ID,
      turnId: PEER_TURN_ID,
      itemId: "call_perm_1",
      cwd: CWD,
      permissions: { fileSystem: { write: ["/var/www"] } },
      startedAtMs: 3,
    },
  },
  {
    request: "mcpServer/elicitation/request",
    params: {
      threadId: PEER_THREAD_ID,
      turnId: PEER_TURN_ID,
      serverName: "github",
      mode: "form",
      message: "Allow the tool call?",
      requestedSchema: { type: "object", properties: {} },
    },
  },
];

describe("a profiled Codex thread's approval requests, answered by its gate", () => {
  it.effect(
    "maps a patch to Edit/Write calls per path and a command to a Bash call, and answers each",
    () =>
      Effect.gen(function* () {
        const calls: Array<ToolCall> = [];
        const harness = yield* withProfile(
          {
            ...PROFILE,
            decideTool: (call) =>
              Effect.sync(() => calls.push(call)).pipe(
                Effect.as(
                  call.toolName === "Bash"
                    ? { kind: "deny" as const, reason: "~/.codex is not the crew's to read." }
                    : { kind: "allow" as const },
                ),
              ),
          },
          [turnMessages],
        );
        yield* harness.adapter.startSession(startInput());
        yield* harness.adapter.sendTurn({ threadId: CREW_THREAD, input: "work", attachments: [] });
        const answers = yield* harness.answers(4);
        assert.deepStrictEqual(answers, [
          { answered: "item/fileChange/requestApproval", result: { decision: "accept" } },
          { answered: "item/commandExecution/requestApproval", result: { decision: "decline" } },
          { answered: "item/permissions/requestApproval", result: { permissions: {} } },
          { answered: "mcpServer/elicitation/request", result: { action: "decline" } },
        ]);
        assert.deepStrictEqual(calls, [
          {
            toolName: "Edit",
            input: { file_path: `${CWD}/src/login.ts` },
            toolUseId: FILE_CHANGE_ITEM,
          },
          {
            toolName: "Write",
            input: { file_path: `${CWD}/src/login.test.ts` },
            toolUseId: FILE_CHANGE_ITEM,
          },
          {
            toolName: "Bash",
            input: { command: "cat /home/zerops/.codex/auth.json" },
            toolUseId: "call_exec_1",
          },
        ]);
        assert.deepStrictEqual(
          harness.events.filter((event) => event.type === "request.opened"),
          [],
          "a gated request reached the person",
        );
      }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );

  it.effect("resolves each gated approval with its request kind", () =>
    Effect.gen(function* () {
      const harness = yield* withProfile(PROFILE, [turnMessages]);
      yield* harness.adapter.startSession(startInput());
      yield* harness.adapter.sendTurn({ threadId: CREW_THREAD, input: "work", attachments: [] });
      yield* harness.answers(4);
      const resolved = yield* harness.eventsOfType("request.resolved", 4);
      const kindOf = (itemId: string) =>
        resolved.find((event) => event.itemId === itemId)?.payload.requestType;
      assert.deepStrictEqual(
        [kindOf(FILE_CHANGE_ITEM), kindOf("call_exec_1"), kindOf("call_perm_1")],
        ["file_change_approval", "command_execution_approval", "permission_approval"],
      );
    }).pipe(Effect.scoped, Effect.provide(contractLayer)),
  );
});
