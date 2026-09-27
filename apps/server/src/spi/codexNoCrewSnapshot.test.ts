// @effect-diagnostics nodeBuiltinImport:off
/**
 * The Codex adapter without a crew: what it writes to Codex, pinned.
 *
 * The golden next to this test was written from the adapter as it stood
 * before the Codex thread profile seam existed. Every registry setup below —
 * none provided, provided but empty, a policy with no profile for the
 * thread — must still produce it byte for byte: a thread with no profile
 * runs on exactly today's wire, and a person answers its approvals. Regenerate
 * only with `SPI_UPDATE_GOLDENS=1` and a reason in the commit message.
 */
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { buildCodexDeveloperInstructions } from "../provider/CodexDeveloperInstructions.ts";
import { buildRuntimeInstructions } from "../provider/RuntimeInstructions.ts";
import {
  codexAdapterHarnessLayer,
  makeCodexAdapterHarness,
  PEER_THREAD_ID,
  PEER_TURN_ID,
  type PeerMessage,
} from "./codexAdapterHarness.ts";
import { ThreadToolPolicyRegistry } from "./threadToolPolicy.ts";
import { checkOrUpdateGolden, describeFirstDivergence } from "./replay/goldenCheck.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const GOLDEN_DIR = NodePath.join(__dirname, "fixtures/codex-options");
const GOLDEN_NAME = "no-crew";

const INSTANCE_ID = ProviderInstanceId.make("codex");
const THREAD_ID = ThreadId.make("codex-options");

// Prose is pinned by identity, not by its words: the golden holds a marker
// wherever the adapter sent exactly today's mode prompt or runtime context,
// so editing the Mate's content contract moves no golden.
const MODE_INSTRUCTION_MARKERS = new Map(
  (["default", "plan"] as const).map((mode) => [
    buildCodexDeveloperInstructions(mode),
    `[buildCodexDeveloperInstructions("${mode}")]`,
  ]),
);

interface TurnSettings {
  readonly model?: string;
  readonly reasoning_effort?: string;
}

const markRuntimeContext = (params: Record<string, unknown>): Record<string, unknown> => {
  const settings = (params.collaborationMode as { settings?: TurnSettings } | undefined)?.settings;
  const context = params.additionalContext as
    | { mate_runtime?: { kind: string; value: string } }
    | undefined;
  if (!settings || !context?.mate_runtime) return params;
  const expected = buildRuntimeInstructions({
    harness: "Codex",
    model: settings.model,
    reasoningEffort: settings.reasoning_effort,
  });
  if (context.mate_runtime.value !== expected) return params;
  return {
    ...params,
    additionalContext: {
      ...context,
      mate_runtime: {
        ...context.mate_runtime,
        value: `[buildRuntimeInstructions({ harness: "Codex", model: "${settings.model}", reasoningEffort: "${settings.reasoning_effort}" })]`,
      },
    },
  };
};

interface Scenario {
  readonly name: string;
  readonly runtimeMode: RuntimeMode;
  readonly modelSelection?: ModelSelection;
  readonly resumeCursor?: unknown;
  /** What the peer sends during the first turn, and how the person answers each request. */
  readonly approvals?: {
    readonly messages: ReadonlyArray<PeerMessage>;
    readonly decisions: ReadonlyArray<"accept" | "acceptForSession" | "decline">;
  };
}

const FILE_CHANGE_ITEM = "call_patch_1";
const COMMAND_ITEM = "call_exec_1";

// Each row drives a different branch of what the adapter writes: the
// full-access defaults, a resumed session with model, effort and service
// tier, and an edits mode whose approvals the person answers.
const SCENARIOS: ReadonlyArray<Scenario> = [
  { name: "full-access, no model", runtimeMode: "full-access" },
  {
    name: "approval-required, model with reasoning effort and fast mode, resumed",
    runtimeMode: "approval-required",
    modelSelection: {
      instanceId: INSTANCE_ID,
      model: "gpt-5.6-sol",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    },
    resumeCursor: { threadId: PEER_THREAD_ID },
  },
  {
    name: "auto-accept-edits, a file change and a command the person answers",
    runtimeMode: "auto-accept-edits",
    approvals: {
      messages: [
        {
          notification: "item/started",
          params: {
            threadId: PEER_THREAD_ID,
            turnId: PEER_TURN_ID,
            item: {
              type: "fileChange",
              id: FILE_CHANGE_ITEM,
              changes: [{ path: "/srv/app/src/index.ts", kind: { type: "update" }, diff: "" }],
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
            itemId: COMMAND_ITEM,
            command: "npm test",
            cwd: "/srv/app",
            startedAtMs: 2,
          },
        },
      ],
      decisions: ["acceptForSession", "decline"],
    },
  },
];

const recordScenario = (scenario: Scenario) =>
  Effect.gen(function* () {
    const harness = yield* makeCodexAdapterHarness({
      turns: scenario.approvals ? [scenario.approvals.messages] : [],
    });
    const { adapter, spawns, wire } = harness;
    yield* adapter.startSession({
      threadId: THREAD_ID,
      provider: ProviderDriverKind.make("codex"),
      runtimeMode: scenario.runtimeMode,
      cwd: "/srv/app",
      ...(scenario.modelSelection ? { modelSelection: scenario.modelSelection } : {}),
      ...(scenario.resumeCursor ? { resumeCursor: scenario.resumeCursor } : {}),
    });
    const requestsOpened: Array<unknown> = [];
    for (const interactionMode of ["default", "plan"] as const) {
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: `a ${interactionMode} turn`,
        attachments: [],
        interactionMode,
        ...(scenario.modelSelection ? { modelSelection: scenario.modelSelection } : {}),
      });
      if (interactionMode !== "default" || !scenario.approvals) continue;
      const { decisions } = scenario.approvals;
      const opened = yield* harness.eventsOfType("request.opened", decisions.length);
      for (const [index, event] of opened.entries()) {
        requestsOpened.push({
          requestType: event.payload.requestType,
          detail: event.payload.detail,
        });
        yield* adapter.respondToRequest(
          THREAD_ID,
          ApprovalRequestId.make(String(event.requestId)),
          decisions[index]!,
        );
      }
      yield* harness.answers(decisions.length);
    }
    yield* adapter.stopAll();
    return {
      scenario: scenario.name,
      spawns,
      requestsOpened,
      wire: wire.map((record) =>
        "method" in record && record.method === "turn/start"
          ? { ...record, params: markRuntimeContext(record.params as Record<string, unknown>) }
          : record,
      ),
    };
  });

const withPolicyRegistry =
  (install: Effect.Effect<void, never, Scope.Scope | ThreadToolPolicyRegistry>) =>
  (scenario: Scenario) =>
    Effect.andThen(install, recordScenario(scenario)).pipe(
      Effect.scoped,
      Effect.provide(ThreadToolPolicyRegistry.layer),
    );

// Three ways a thread ends up without a profile.
const REGISTRY_SETUPS = [
  {
    name: "no registry",
    record: (scenario: Scenario) => Effect.scoped(recordScenario(scenario)),
  },
  { name: "an empty registry", record: withPolicyRegistry(Effect.void) },
  {
    name: "a policy with no profile for the thread",
    record: withPolicyRegistry(
      Effect.gen(function* () {
        yield* (yield* ThreadToolPolicyRegistry).install({
          profileFor: () => Effect.succeed(undefined),
        });
      }),
    ),
  },
];

// Through JSON once, so the comparison sees exactly what the golden file can hold.
const recordAll = (setup: (typeof REGISTRY_SETUPS)[number]) =>
  Effect.forEach(SCENARIOS, setup.record).pipe(
    Effect.map((records): ReadonlyArray<Record<string, unknown>> =>
      JSON.parse(JSON.stringify(records), (key, value) =>
        key === "version" && typeof value === "string"
          ? "[package version]"
          : (MODE_INSTRUCTION_MARKERS.get(value) ?? value),
      ),
    ),
    Effect.provide(codexAdapterHarnessLayer),
  );

describe("the Codex adapter without a crew", () => {
  it.effect("writes today's spawn, thread, turn and approval messages", () =>
    Effect.gen(function* () {
      const [baseline, ...others] = yield* Effect.forEach(REGISTRY_SETUPS, (setup) =>
        Effect.map(recordAll(setup), (records) => ({ setup: setup.name, records })),
      );
      for (const other of others) {
        assert.deepStrictEqual(other.records, baseline!.records, other.setup);
      }
      const records = baseline!.records;
      const { updated, expected } = checkOrUpdateGolden(GOLDEN_DIR, GOLDEN_NAME, records);
      if (updated) return;
      const divergence = describeFirstDivergence(GOLDEN_NAME, records, expected);
      assert.isUndefined(divergence, divergence);
      assert.deepStrictEqual(records, expected);
    }),
  );
});
