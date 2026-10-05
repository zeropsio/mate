import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { classifyModelSelectionChange, sameModelSelection } from "./modelSelectionChange.ts";

const claude = ProviderInstanceId.make("claudeAgent");
const select = (
  options?: ModelSelection["options"],
  model = "claude-opus",
  instanceId = claude,
): ModelSelection => ({ instanceId, model, ...(options !== undefined ? { options } : {}) });

describe("sameModelSelection", () => {
  it.each([
    {
      name: "option order does not count",
      a: select([
        { id: "effort", value: "max" },
        { id: "fastMode", value: true },
      ]),
      b: select([
        { id: "fastMode", value: true },
        { id: "effort", value: "max" },
      ]),
      same: true,
    },
    { name: "absent and empty options are the same", a: select(), b: select([]), same: true },
    {
      name: "a different effort differs",
      a: select([{ id: "effort", value: "xhigh" }]),
      b: select([{ id: "effort", value: "max" }]),
      same: false,
    },
    {
      name: "an option set against none differs",
      a: select(),
      b: select([{ id: "effort", value: "max" }]),
      same: false,
    },
    { name: "a different model differs", a: select([], "a"), b: select([], "b"), same: false },
  ])("$name", ({ a, b, same }) => {
    expect(sameModelSelection(a, b)).toBe(same);
    expect(sameModelSelection(b, a)).toBe(same);
  });
});

describe("classifyModelSelectionChange", () => {
  const effortOnly = ["effort"];
  it.each([
    {
      name: "an unknown session selection needs a new session",
      previous: undefined,
      requested: select([{ id: "effort", value: "max" }]),
      expected: "new-session",
    },
    {
      name: "the same selection in another option order changes nothing",
      previous: select([
        { id: "effort", value: "max" },
        { id: "thinking", value: true },
      ]),
      requested: select([
        { id: "thinking", value: true },
        { id: "effort", value: "max" },
      ]),
      expected: "none",
    },
    {
      name: "an effort change is applied in the session",
      previous: select([{ id: "effort", value: "xhigh" }]),
      requested: select([{ id: "effort", value: "max" }]),
      expected: "in-session",
    },
    {
      name: "an effort cleared is applied in the session",
      previous: select([{ id: "effort", value: "xhigh" }]),
      requested: select(),
      expected: "in-session",
    },
    {
      name: "a model change is applied in the session where the adapter switches models",
      previous: select([], "claude-sonnet"),
      requested: select([], "claude-opus"),
      expected: "in-session",
    },
    {
      name: "a change to an option the session cannot apply needs a new session",
      previous: select([{ id: "fastMode", value: false }]),
      requested: select([{ id: "fastMode", value: true }]),
      expected: "new-session",
    },
    {
      name: "effort together with a start-only option needs a new session",
      previous: select([{ id: "effort", value: "xhigh" }]),
      requested: select([
        { id: "effort", value: "max" },
        { id: "thinking", value: false },
      ]),
      expected: "new-session",
    },
    {
      name: "another instance needs a new session",
      previous: select(),
      requested: select([], "claude-opus", ProviderInstanceId.make("claudeAgent_work")),
      expected: "new-session",
    },
  ] as const)("$name", ({ previous, requested, expected }) => {
    expect(
      classifyModelSelectionChange({
        previous,
        requested,
        inSessionOptions: effortOnly,
        modelSwitchInSession: true,
      }),
    ).toBe(expected);
  });

  it("a model change needs a new session where the adapter cannot switch models", () => {
    expect(
      classifyModelSelectionChange({
        previous: select([], "claude-sonnet"),
        requested: select([], "claude-opus"),
        inSessionOptions: effortOnly,
        modelSwitchInSession: false,
      }),
    ).toBe("new-session");
  });
});
