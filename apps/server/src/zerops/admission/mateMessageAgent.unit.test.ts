import {
  defaultInstanceIdForAgent,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { mateMessageAgent } from "./mateMessageAgent.ts";

const extraId = ProviderInstanceId.make("codex-work");
const codex: ServerProvider = {
  instanceId: defaultInstanceIdForAgent("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-26T20:00:00Z",
  models: [
    {
      slug: "gpt-default",
      name: "Default model",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    {
      slug: "gpt-project",
      name: "Project model",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "high", label: "High" },
              { id: "xhigh", label: "Extra High" },
            ],
          },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
};
const extra = { ...codex, instanceId: extraId };

/** A Mate with no conversation, its stand-up's wait over and two admitted logins. */
const noConversation = {
  main: undefined,
  standUpSettled: true,
  mayRun: [codex.instanceId, extraId],
  projectDefault: null,
  providers: [codex, extra],
} as const;
const noAgent = { agent: null, activeRun: null, lastEnded: null, queued: [] } as const;
const onCodex = {
  kind: "given",
  agent: { instanceId: defaultInstanceIdForAgent("codex"), profile: { kind: "mate" } },
} as const;

// witness: apps/server/src/zerops/admission/mateMessageAgent.ts | provider.instanceId === input.mayRun[0] → provider.instanceId === input.mayRun[1]
it("TA12: A message to a Mate with no conversation, or whose main conversation has no agent, gives it the first admitted owner login with its model, driver and new-conversation effort, and waits while the stand-up or its provider snapshot is pending or no owner login admits it; breaks: a new Mate never works another Mate's message, runs it on the wrong model or opens a second conversation beside its stand-up's", () => {
  expect(mateMessageAgent(noConversation)).toMatchObject(onCodex);
  expect(mateMessageAgent({ ...noConversation, main: noAgent })).toMatchObject(onCodex);
  expect(mateMessageAgent({ ...noConversation, standUpSettled: false })).toEqual({
    kind: "wait-stand-up",
  });
  expect(mateMessageAgent({ ...noConversation, mayRun: [] })).toEqual({ kind: "wait-sign-in" });
  expect(mateMessageAgent({ ...noConversation, providers: [] })).toEqual({
    kind: "wait-provider",
  });
  expect(
    mateMessageAgent({
      ...noConversation,
      mayRun: [extraId, codex.instanceId],
      projectDefault: { instanceId: extraId, model: "gpt-project" },
    }),
  ).toEqual({
    kind: "given",
    agent: {
      instanceId: extraId,
      driver: codex.driver,
      model: "gpt-project",
      options: [{ id: "reasoningEffort", value: "xhigh" }],
      profile: { kind: "mate" },
    },
  });
});
