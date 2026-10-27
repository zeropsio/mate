import type { ModelCapabilities } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { composerModelOptionsFor, isNewConversation } from "./newConversationEffort";

describe("isNewConversation", () => {
  const cases: ReadonlyArray<
    readonly [string, "server" | "draft", Parameters<typeof isNewConversation>[1], boolean]
  > = [
    ["a draft is new", "draft", undefined, true],
    ["a thread that never ran a turn is new", "server", { latestTurn: null }, true],
    [
      "a thread that ran a turn has its effort",
      "server",
      { latestTurn: { turnId: "t" } as never },
      false,
    ],
    [
      "a crewmate's thread keeps the crew's rule",
      "server",
      { latestTurn: null, crew: {} as never },
      false,
    ],
    ["a thread still loading is not judged new", "server", undefined, false],
  ];
  it.each(cases)("%s", (_name, routeKind, thread, expected) => {
    expect(isNewConversation(routeKind, thread)).toBe(expected);
  });
});

describe("composerModelOptionsFor", () => {
  const capabilities: ModelCapabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Effort",
        type: "select",
        options: [
          { id: "medium", label: "Medium", isDefault: true },
          { id: "xhigh", label: "Extra High" },
          { id: "max", label: "Max" },
        ],
      },
    ],
  };
  const cases: ReadonlyArray<
    readonly [
      string,
      boolean,
      ReadonlyArray<{ id: string; value: string | boolean }> | undefined,
      ReadonlyArray<{ id: string; value: string | boolean }> | undefined,
    ]
  > = [
    [
      "a new conversation starts on Extra High",
      true,
      undefined,
      [{ id: "effort", value: "xhigh" }],
    ],
    [
      "a person's pick in a new conversation wins",
      true,
      [{ id: "effort", value: "medium" }],
      [{ id: "effort", value: "medium" }],
    ],
    ["a running conversation keeps what it has", false, undefined, undefined],
  ];
  it.each(cases)("%s", (_name, isNew, options, expected) => {
    expect(composerModelOptionsFor({ isNew, capabilities, options })).toEqual(expected);
  });
});
