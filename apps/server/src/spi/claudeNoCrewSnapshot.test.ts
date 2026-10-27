// @effect-diagnostics nodeBuiltinImport:off
/**
 * The Claude adapter without a crew: what it hands the SDK, pinned.
 *
 * The golden next to this test was written from the adapter as it stood
 * before the thread tool policy seam (ARCHITECTURE seam 8) existed. Every
 * registry setup below — none provided, provided but empty, a policy with
 * no profile for the thread — must still produce it byte for byte: a
 * thread with no profile runs on exactly today's options. Regenerate only with
 * `SPI_UPDATE_GOLDENS=1` and a reason in the commit message.
 */
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "@effect/vitest";
import {
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import { buildRuntimeInstructions } from "../provider/RuntimeInstructions.ts";
import {
  claudeAdapterHarnessLayer,
  makeClaudeAdapterHarness,
  toComparable,
} from "./claudeAdapterHarness.ts";
import {
  SYNTHETIC_CLAUDE_CAPABLE_MODEL,
  SYNTHETIC_CLAUDE_THINKING_MODEL,
} from "./claudeProviderTest.ts";
import {
  type ClaudeThreadExtensions,
  ClaudeThreadExtensionRegistry,
} from "./claudeThreadProfile.ts";
import { ThreadToolPolicyRegistry } from "./threadToolPolicy.ts";
import { checkOrUpdateGolden, describeFirstDivergence } from "./replay/goldenCheck.ts";
import { redact } from "./replay/redact.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const GOLDEN_DIR = NodePath.join(__dirname, "fixtures/claude-options");
const GOLDEN_NAME = "no-crew";

const INSTANCE_ID = ProviderInstanceId.make("claudeAgent");

// The appended prompt is pinned by identity, not by its prose: the golden
// holds this marker wherever the adapter appended exactly today's runtime
// instructions, so editing the Mate's content contract moves no golden.
const RUNTIME_INSTRUCTIONS = buildRuntimeInstructions({ harness: "Claude Code" });
const RUNTIME_INSTRUCTIONS_MARKER = '[buildRuntimeInstructions({ harness: "Claude Code" })]';

interface Scenario {
  readonly name: string;
  readonly settings: Parameters<typeof makeClaudeAdapterHarness>[0];
  readonly runtimeMode: RuntimeMode;
  readonly cwd?: string;
  readonly modelSelection?: ModelSelection;
  readonly resumeCursor?: unknown;
}

// Each row drives a different branch of the options the adapter builds:
// the bypass pair, a resumed session with model/effort/fast mode in a cwd,
// and a launch-arg permission mode with an auto-compact window and thinking.
const SCENARIOS: ReadonlyArray<Scenario> = [
  { name: "full-access, no cwd, no model", settings: {}, runtimeMode: "full-access" },
  {
    name: "approval-required, cwd, model with effort and fast mode, resumed",
    settings: {},
    runtimeMode: "approval-required",
    cwd: "/srv/app",
    modelSelection: {
      instanceId: INSTANCE_ID,
      model: SYNTHETIC_CLAUDE_CAPABLE_MODEL,
      options: [
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
        { id: "contextWindow", value: "standard" },
      ],
    },
    resumeCursor: {
      threadId: "claude-options-resumed",
      resume: "5d9f1c3a-7b2e-4c8d-9a1f-3e6b8c0d2f47",
      turnCount: 2,
    },
  },
  {
    name: "auto-accept-edits, launch-arg permission mode, auto-compact window, thinking",
    settings: {
      launchArgs: "--permission-mode acceptEdits --thinking-display summarized",
      autoCompactWindow: "400000",
    },
    runtimeMode: "auto-accept-edits",
    cwd: "/srv/app",
    modelSelection: {
      instanceId: INSTANCE_ID,
      model: SYNTHETIC_CLAUDE_THINKING_MODEL,
      options: [{ id: "thinking", value: true }],
    },
  },
];

const recordScenario = (scenario: Scenario) =>
  Effect.gen(function* () {
    const { adapter, sessions, firstEvent } = yield* makeClaudeAdapterHarness(scenario.settings);
    const threadId = ThreadId.make("claude-options");
    yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("claudeAgent"),
      runtimeMode: scenario.runtimeMode,
      ...(scenario.cwd ? { cwd: scenario.cwd } : {}),
      ...(scenario.modelSelection ? { modelSelection: scenario.modelSelection } : {}),
      ...(scenario.resumeCursor ? { resumeCursor: scenario.resumeCursor } : {}),
    });
    for (const interactionMode of ["default", "plan"] as const) {
      yield* adapter.sendTurn({
        threadId,
        input: `a ${interactionMode} turn`,
        attachments: [],
        interactionMode,
        ...(scenario.modelSelection ? { modelSelection: scenario.modelSelection } : {}),
      });
    }
    const [session] = sessions;
    const configured = yield* firstEvent("session.configured");
    return {
      scenario: scenario.name,
      queryOptions: toComparable(session?.options),
      sessionConfigured: configured.payload,
      setModelCalls: session?.query.setModelCalls,
      setPermissionModeCalls: session?.query.setPermissionModeCalls,
    };
  });

const extensionForEveryThread: ClaudeThreadExtensions = {
  extensionFor: () =>
    Effect.succeed({
      settings: { autoMemoryEnabled: false, disableAllHooks: false },
      onSessionStart: () => Effect.succeed("never appended"),
      onPostCompact: () => Effect.void,
    }),
};

const withRegistries =
  (
    install: Effect.Effect<
      void,
      never,
      Scope.Scope | ThreadToolPolicyRegistry | ClaudeThreadExtensionRegistry
    >,
  ) =>
  (scenario: Scenario) =>
    Effect.andThen(install, recordScenario(scenario)).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.merge(ThreadToolPolicyRegistry.layer, ClaudeThreadExtensionRegistry.layer),
      ),
    );

// Three ways a thread ends up without a profile. An extension alone changes
// nothing: only a profile opts a thread in.
const REGISTRY_SETUPS = [
  {
    name: "no registries",
    record: (scenario: Scenario) => Effect.scoped(recordScenario(scenario)),
  },
  { name: "empty registries", record: withRegistries(Effect.void) },
  {
    name: "a policy with no profile for the thread",
    record: withRegistries(
      Effect.gen(function* () {
        yield* (yield* ThreadToolPolicyRegistry).install({
          profileFor: () => Effect.succeed(undefined),
        });
        yield* (yield* ClaudeThreadExtensionRegistry).install(extensionForEveryThread);
      }),
    ),
  },
];

// Through JSON once, so the comparison sees exactly what the golden file can hold.
const recordAll = (setup: (typeof REGISTRY_SETUPS)[number]) =>
  Effect.forEach(SCENARIOS, setup.record).pipe(
    Effect.map((records): ReadonlyArray<Record<string, unknown>> =>
      JSON.parse(
        JSON.stringify(redact(records, { ids: [{ fields: ["sessionId"], prefix: "session" }] })),
        (_key, value) => (value === RUNTIME_INSTRUCTIONS ? RUNTIME_INSTRUCTIONS_MARKER : value),
      ),
    ),
    Effect.provide(claudeAdapterHarnessLayer),
  );

describe("the Claude adapter without a crew", () => {
  it.effect("builds today's query options, session config and permission calls", () =>
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
