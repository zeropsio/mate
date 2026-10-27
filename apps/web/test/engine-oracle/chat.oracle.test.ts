import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EngineAnswerInput,
  EngineReceiptInput,
  EngineSendInput,
  EngineSetRuntimeModeInput,
  EngineSteerInput,
  EngineSwitchModelInput,
  MATE_ENGINE_PROTOCOLS,
  ProviderSessionStartInput,
  ProviderSendTurnInput,
  type OrchestrationThread,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { engineThreadOf, makeMateEngineOperations } from "@t3tools/client-runtime/data";
import {
  engineRespondToApproval,
  engineRespondToUserInput,
  engineSetRuntimeMode,
  engineStartTurn,
  engineUpdateMetadata,
} from "../../../../packages/client-runtime/src/data/engineCommands.ts";
import type { MateEngineHost } from "../../../../packages/client-runtime/src/data/engineHost.ts";
import { derivePendingRequests } from "../../../../packages/client-runtime/src/pendingRequests.ts";
import {
  buildPendingUserInputAnswers,
  togglePendingUserInputOptionSelection,
} from "../../src/pendingUserInput.ts";
import { ComposerModelChoices } from "../../src/components/chat/ComposerModelControl.tsx";
import { ComposerPendingUserInputPanel } from "../../src/components/chat/ComposerPendingUserInputPanel.tsx";
import { ComposerPendingApprovalPanel } from "../../src/components/chat/ComposerPendingApprovalPanel.tsx";
import { makeEngineWire } from "../../../server/src/engine/wire/EngineWire.ts";
import { KEY, makeOracleWorld } from "./world.ts";

const decodeSend = Schema.decodeUnknownSync(EngineSendInput);
const decodeSteer = Schema.decodeUnknownSync(EngineSteerInput);
const decodeAnswer = Schema.decodeUnknownSync(EngineAnswerInput);
const decodeRuntimeMode = Schema.decodeUnknownSync(EngineSetRuntimeModeInput);
const decodeModel = Schema.decodeUnknownSync(EngineSwitchModelInput);
const decodeReceipt = Schema.decodeSync(EngineReceiptInput);
const decodeSessionStart = Schema.decodeUnknownEffect(ProviderSessionStartInput);
const decodeTurn = Schema.decodeUnknownEffect(ProviderSendTurnInput);

const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "m1",
    name: "Test model",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "effort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "low", label: "Low", isDefault: true },
            { id: "high", label: "High" },
          ],
        },
      ],
    },
  },
];
const pickedChoices = (thread: OrchestrationThread) =>
  renderToStaticMarkup(
    createElement(ComposerModelChoices, {
      traits: {
        provider: "claudeAgent" as never,
        models,
        model: thread.modelSelection.model,
        modelOptions: thread.modelSelection.options,
        prompt: "",
        onPromptChange: () => {},
        planModeEnabled: false,
        onModelOptionsChange: () => {},
      },
      runtimeMode: thread.runtimeMode,
      onRuntimeModeChange: () => {},
    }),
  );
const picked = (markup: string, label: string) =>
  (markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
    .find((button) => button.includes(`>${label}<`))
    ?.includes('aria-checked="true"') ?? false;

// The existing oracle world supplies the engine and read client. Its write side goes through
// the same command translation and account operations as ChatView, into that engine's wire.
const chat = Effect.gen(function* () {
  const world = yield* makeOracleWorld;
  const client = world.openClient();
  yield* world.settle;
  const wire = yield* world.w.within(makeEngineWire({ coalesce: 0 }));
  const caller = { subject: "zerops-user:ana", environmentId: KEY.environmentId, epoch: 4 };
  const protocol = Math.max(...MATE_ENGINE_PROTOCOLS);
  let id = 0;
  const operations = makeMateEngineOperations({
    store: client.store,
    makeId: () => `chat-operation-${++id}`,
    wire: {
      call: (_environmentId, command) => {
        const input = { ...command, protocol };
        switch (command.kind) {
          case "send":
            return wire.send(decodeSend(input), caller);
          case "steer":
            return wire.steer(decodeSteer(input), caller);
          case "answer":
            return wire.answer(decodeAnswer(input), caller);
          case "set-runtime-mode":
            return wire.setRuntimeMode(decodeRuntimeMode(input), caller);
          case "switch-model":
            return wire.switchModel(decodeModel(input), caller);
          default:
            return Effect.die(new Error(`This chat proof does not issue ${command.kind}.`));
        }
      },
      receipt: (_environmentId, conversationId, commandId) =>
        wire.receipt(
          decodeReceipt({
            protocol,
            conversationId: conversationId as never,
            commandId: commandId as never,
          }),
        ),
    },
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => operations.close()));
  const host = { store: client.store, operations } as unknown as MateEngineHost;
  const read = () => {
    const thread = engineThreadOf(client.reads(), KEY);
    assert.isNotNull(thread, "ASSERTION: the conversation reaches the real chat projection");
    return thread!;
  };
  let messages = 0;
  const send = (text: string, interactionMode: "default" | "plan" = "default") =>
    engineStartTurn(KEY.environmentId, {
      threadId: KEY.conversationId as never,
      message: {
        messageId: `chat-message-${++messages}` as never,
        role: "user",
        text,
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode,
    })(host).pipe(Effect.tap(() => world.settle));
  const reload = Effect.gen(function* () {
    const fresh = world.openClient();
    yield* world.settle;
    const thread = engineThreadOf(fresh.reads(), KEY);
    assert.isNotNull(thread, "ASSERTION: a fresh client reads the durable conversation");
    fresh.close();
    return thread!;
  });
  return { world, client, host, read, send, reload };
});

describe("chat commands through the engine and the chat projection", () => {
  it.effect("Send now puts a waiting message into the running turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* chat;
        yield* c.send("Tell me a short story");
        const run = c.read().latestTurn!.turnId;
        yield* c.send("Change of plan: keep it under 120 words");
        yield* c.world.w.agent((agent, thread) =>
          agent.say(thread, "A short story about a lighthouse cat"),
        );
        yield* c.world.w.agent((agent, thread) => agent.finish(thread));
        yield* c.world.settle;
        assert.strictEqual(
          (yield* c.world.w.runs).length,
          1,
          "ASSERTION: Send now steers the existing run instead of opening another",
        );
        assert.strictEqual(c.read().latestTurn!.turnId, run);
        const messages = c.read().messages;
        const sent = messages.filter(
          (message) => message.text === "Change of plan: keep it under 120 words",
        );
        const answers = messages.filter((message) =>
          message.text.includes("A short story about a lighthouse cat"),
        );
        assert.strictEqual(sent.length, 1, "ASSERTION: the steering message is shown once");
        assert.strictEqual(answers.length, 1, "ASSERTION: completion retains the answer once");
        assert.isBelow(
          messages.indexOf(sent[0]!),
          messages.indexOf(answers[0]!),
          "ASSERTION: the sent message comes before the answer in the consumer's record",
        );
        assert.strictEqual(c.world.w.provider.sends.length, 2);
      }),
    ),
  );

  const respondToApproval = (decision: "accept" | "decline") =>
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* chat;
        yield* c.send("Inspect the build");
        const providerRequestId = yield* c.world.w.agent((agent, thread) =>
          agent.ask(thread, "approval"),
        );
        yield* c.world.settle;
        const approvals = derivePendingRequests(c.read().activities).approvals;
        assert.strictEqual(
          approvals.length,
          1,
          "ASSERTION: the agent's request is shown by the chat projection",
        );
        const markup = renderToStaticMarkup(
          createElement(ComposerPendingApprovalPanel, {
            approval: approvals[0]!,
            pendingCount: approvals.length,
          }),
        );
        assert.include(
          markup,
          "wants to run this command",
          "ASSERTION: the approval consumer shows what the agent asks",
        );
        assert.include(
          markup,
          "rm -rf dist",
          "ASSERTION: the approval consumer shows the actual command",
        );
        const requestId = approvals[0]!.requestId;
        yield* engineRespondToApproval(KEY.environmentId, {
          threadId: KEY.conversationId as never,
          requestId: requestId as never,
          decision,
        })(c.host);
        yield* c.world.settle;
        assert.deepStrictEqual(
          c.world.w.provider.calls.filter((call) => call.startsWith("approve ")),
          [`approve ${providerRequestId} ${decision}`],
          "ASSERTION: exactly the person's decision reaches the provider",
        );
        assert.isTrue(
          c
            .read()
            .activities.some(
              (activity) =>
                activity.kind === "approval.resolved" &&
                activity.summary === (decision === "accept" ? "Approved" : "Declined"),
            ),
          "ASSERTION: the consumer sees the request resolve with the chosen decision",
        );
        assert.deepStrictEqual(
          derivePendingRequests(c.read().activities).approvals,
          [],
          "ASSERTION: the resolved approval no longer offers a response",
        );
        assert.deepStrictEqual(
          (yield* c.world.w.requests).map((request) => request.state),
          ["answered"],
        );
      }),
    );
  it.effect("approve an agent command and see it resolve", () => respondToApproval("accept"));
  it.effect("decline an agent command and see it resolve", () => respondToApproval("decline"));

  it.effect("answer an agent question with a suggested option", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* chat;
        yield* c.send("Inspect the project");
        const providerRequestId = yield* c.world.w.agent((agent, thread) =>
          agent.ask(thread, "question"),
        );
        yield* c.world.w.agent((agent, thread) =>
          agent.emit("user-input.requested", thread, {
            requestId: providerRequestId,
            turnId: "T1",
            payload: {
              questions: [
                {
                  id: "target",
                  header: "Environment",
                  question: "Which environment should I inspect?",
                  options: [
                    {
                      label: "Staging",
                      value: "staging-environment",
                      description: "Inspect staging",
                    },
                  ],
                  multiSelect: false,
                  allowCustomAnswer: true,
                },
              ],
            },
          }),
        );
        yield* c.world.settle;
        const questions = derivePendingRequests(c.read().activities).userInputs;
        assert.strictEqual(
          questions.length,
          1,
          "ASSERTION: the agent's question reaches the real consumer",
        );
        const request = questions[0]!;
        const markup = renderToStaticMarkup(
          createElement(ComposerPendingUserInputPanel, {
            pendingUserInputs: questions,
            respondingRequestIds: [],
            answers: {},
            questionIndex: 0,
            onToggleOption: () => {},
            onAdvance: () => {},
            onDismiss: () => {},
          }),
        );
        assert.include(markup, "Which environment should I inspect?");
        assert.include(markup, "Staging");
        const question = request.questions[0]!;
        const option = question.options[0]!;
        assert.strictEqual(option.label, "Staging");
        const draft = togglePendingUserInputOptionSelection(
          question,
          undefined,
          option.value ?? option.label,
        );
        const answers = buildPendingUserInputAnswers(request.questions, { [question.id]: draft });
        assert.deepStrictEqual(
          answers,
          { target: "staging-environment" },
          "ASSERTION: a suggested option submits its native value rather than its display label",
        );
        yield* engineRespondToUserInput(KEY.environmentId, {
          threadId: KEY.conversationId as never,
          requestId: request.requestId,
          answers: answers!,
        })(c.host);
        yield* c.world.settle;
        assert.deepStrictEqual(
          c.world.w.provider.calls.filter((call) => call.startsWith("answer ")),
          [`answer ${providerRequestId}`],
        );
        assert.deepStrictEqual(
          derivePendingRequests(c.read().activities).userInputs,
          [],
          "ASSERTION: the answered question no longer offers an answer",
        );
        const resolution = c
          .read()
          .activities.find((activity) => activity.kind === "user-input.resolved");
        assert.deepInclude(
          resolution?.payload,
          { answers: { target: "staging-environment" } },
          "ASSERTION: the accepted native answer is shown by the real chat projection",
        );
      }),
    ),
  );

  it.effect(
    "the effort a person picks goes with their next message and stays picked after reload",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const c = yield* chat;
          yield* engineUpdateMetadata(KEY.environmentId, {
            threadId: KEY.conversationId as never,
            modelSelection: {
              instanceId: "claudeAgent" as never,
              model: "m1",
              options: [{ id: "effort", value: "high" }],
            },
          })(c.host);
          yield* c.world.settle;
          yield* c.send("Inspect it at high effort");
          const started = yield* decodeSessionStart(c.world.w.provider.starts[0]);
          assert.deepStrictEqual(
            started.modelSelection?.options,
            [{ id: "effort", value: "high" }],
            "ASSERTION: the picked effort reaches the agent's session",
          );
          assert.deepStrictEqual(c.read().modelSelection.options, [
            { id: "effort", value: "high" },
          ]);
          const fresh = yield* c.reload;
          assert.deepStrictEqual(
            fresh.modelSelection.options,
            [{ id: "effort", value: "high" }],
            "ASSERTION: the fresh chat consumer reads the same picked effort",
          );
          assert.isTrue(
            picked(pickedChoices(fresh), "High"),
            "ASSERTION: the fresh composer's effort choice is High",
          );
        }),
      ),
  );

  it.effect(
    "the access a person picks reaches the Mate with their next message and stays picked after reload",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const c = yield* chat;
          yield* engineSetRuntimeMode(KEY.environmentId, {
            threadId: KEY.conversationId as never,
            runtimeMode: "approval-required",
          })(c.host);
          yield* c.world.settle;
          yield* c.send("Ask before you change anything");
          const started = yield* decodeSessionStart(c.world.w.provider.starts[0]);
          assert.strictEqual(
            started.runtimeMode,
            "approval-required",
            "ASSERTION: the picked access reaches the provider before its next turn",
          );
          assert.strictEqual(c.read().runtimeMode, "approval-required");
          const fresh = yield* c.reload;
          assert.strictEqual(
            fresh.runtimeMode,
            "approval-required",
            "ASSERTION: a fresh chat consumer reads the persisted access",
          );
          assert.isTrue(
            picked(pickedChoices(fresh), "Supervised"),
            "ASSERTION: the fresh composer's access choice is Supervised",
          );
        }),
      ),
  );

  it.effect("with plan mode on, a message sent in plan mode goes to the agent as a plan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const c = yield* chat;
        yield* c.send("Plan the worker's migration", "plan");
        const sent = yield* decodeTurn(c.world.w.provider.sends[0]);
        assert.strictEqual(
          sent.interactionMode,
          "plan",
          "ASSERTION: this message reaches the provider in plan mode",
        );
        assert.strictEqual(c.read().interactionMode, "plan");
        assert.strictEqual(
          c.read().messages.filter((message) => message.text === "Plan the worker's migration")
            .length,
          1,
        );
        assert.strictEqual((yield* c.world.w.runs).length, 1);
      }),
    ),
  );
});
