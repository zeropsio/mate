import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { describe, expect, it } from "vite-plus/test";

import { keptAgentPanelModel } from "./keptAgentPanelModel";

const model = (runningCount: number) => ({ ...emptyAgentPanelModel(), runningCount });

describe("keptAgentPanelModel", () => {
  it.each([
    { name: "the same helpers, derived again", next: model(1), kept: true },
    { name: "a helper that started", next: model(2), kept: false },
  ])("$name", ({ next, kept }) => {
    const key = `conversation-${kept}`;
    const first = keptAgentPanelModel(key, model(1));
    expect(keptAgentPanelModel(key, next) === first).toBe(kept);
    expect(keptAgentPanelModel(key, next)).toStrictEqual(next);
  });

  it("keeps each conversation's apart", () => {
    const one = keptAgentPanelModel("one", model(1));
    keptAgentPanelModel("two", model(2));
    expect(keptAgentPanelModel("one", model(1))).toBe(one);
    expect(keptAgentPanelModel("two", model(1)).runningCount).toBe(1);
  });

  it("hands on what it is given where no conversation is named", () => {
    const given = model(1);
    expect(keptAgentPanelModel(null, given)).toBe(given);
  });
});
