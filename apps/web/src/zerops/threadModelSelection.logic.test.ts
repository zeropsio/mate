import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { modelSelectionKey, selectionToWrite } from "./threadModelSelection.logic.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const withEffort = (effort: string, extra: ModelSelection["options"] = []): ModelSelection => ({
  instanceId: claude,
  model: "claude-opus",
  options: [{ id: "effort", value: effort }, ...(extra ?? [])],
});

describe("modelSelectionKey", () => {
  it.each([
    {
      name: "option order does not count",
      a: withEffort("max", [{ id: "thinking", value: true }]),
      b: {
        instanceId: claude,
        model: "claude-opus",
        options: [
          { id: "thinking", value: true },
          { id: "effort", value: "max" },
        ],
      },
      same: true,
    },
    {
      name: "absent and empty options are the same",
      a: { instanceId: claude, model: "claude-opus" },
      b: { instanceId: claude, model: "claude-opus", options: [] },
      same: true,
    },
    { name: "another effort differs", a: withEffort("xhigh"), b: withEffort("max"), same: false },
  ])("$name", ({ a, b, same }) => {
    expect(modelSelectionKey(a) === modelSelectionKey(b)).toBe(same);
  });
});

describe("selectionToWrite", () => {
  it.each([
    {
      name: "a pick in this tab goes to the thread",
      threadChanged: false,
      draft: { modelSelectionByProvider: { [claude]: withEffort("max") } },
      thread: withEffort("xhigh"),
      expected: withEffort("max"),
    },
    {
      name: "a draft without a pick writes nothing",
      threadChanged: false,
      draft: { modelSelectionByProvider: {} },
      thread: withEffort("xhigh"),
      expected: null,
    },
    {
      name: "a pick equal to the thread's writes nothing",
      threadChanged: false,
      draft: { modelSelectionByProvider: { [claude]: withEffort("xhigh") } },
      thread: withEffort("xhigh"),
      expected: null,
    },
    {
      name: "a stale tab copy never overwrites a thread that changed under it",
      threadChanged: true,
      draft: { modelSelectionByProvider: { [claude]: withEffort("xhigh") } },
      thread: withEffort("max"),
      expected: null,
    },
    {
      name: "the pick for the instance the draft shows goes",
      threadChanged: false,
      draft: {
        activeProvider: ProviderInstanceId.make("claudeAgent_work"),
        modelSelectionByProvider: {
          [claude]: withEffort("low"),
          [ProviderInstanceId.make("claudeAgent_work")]: {
            instanceId: ProviderInstanceId.make("claudeAgent_work"),
            model: "claude-opus",
          },
        },
      },
      thread: withEffort("xhigh"),
      expected: { instanceId: ProviderInstanceId.make("claudeAgent_work"), model: "claude-opus" },
    },
  ])("$name", ({ threadChanged, draft, thread, expected }) => {
    expect(selectionToWrite({ threadChanged, draft, threadSelection: thread })).toEqual(expected);
  });
});
