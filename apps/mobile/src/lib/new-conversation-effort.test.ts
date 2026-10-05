import { type ModelSelection, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { newConversationSelection } from "./new-conversation-effort";

// D10: on the phone too, a new conversation starts on Extra High; one that ran keeps its effort,
// and a person's own pick wins.
const codex = {
  instanceId: ProviderInstanceId.make("codex"),
  models: [
    {
      slug: "gpt-5.5",
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium", isDefault: true },
              { id: "high", label: "High" },
              { id: "xhigh", label: "Extra High" },
            ],
          },
        ],
      },
    },
  ],
} as unknown as ServerProvider;

const gpt = (options?: ModelSelection["options"]): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.5",
  ...(options ? { options } : {}),
});

describe("newConversationSelection", () => {
  const cases: ReadonlyArray<
    readonly [string, boolean, ModelSelection | null, ModelSelection | null]
  > = [
    [
      "a new conversation starts on Extra High",
      true,
      gpt(),
      gpt([{ id: "reasoningEffort", value: "xhigh" }]),
    ],
    [
      "a person's pick wins",
      true,
      gpt([{ id: "reasoningEffort", value: "low" }]),
      gpt([{ id: "reasoningEffort", value: "low" }]),
    ],
    ["a conversation that ran keeps what it has", false, gpt(), gpt()],
    ["no selection stays none", true, null, null],
  ];
  it.each(cases)("%s", (_name, isNew, selection, expected) => {
    expect(newConversationSelection({ isNew, providers: [codex], selection })).toEqual(expected);
  });
});
