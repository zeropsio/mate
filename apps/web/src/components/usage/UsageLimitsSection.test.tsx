import { EnvironmentId } from "@t3tools/contracts";
import { RegistryContext } from "@effect/atom-react";
import type { AtomRegistry } from "effect/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vite-plus/test";

const testState = {
  presentations: new Map<unknown, unknown>(),
};
const registry = {
  get: () => testState.presentations,
  subscribe: () => () => {},
} as unknown as AtomRegistry.AtomRegistry;

import { READING_LIMITS_LINE, UsageLimitsSection } from "./UsageLimits";

const NONE = "No coding agent on your connected Mates reports subscription limits.";

type Phase = "available" | "offline" | "connecting" | "reconnecting" | "connected" | "error";

const environment = (phase: Phase, providers: readonly unknown[] | null = null) => ({
  entry: { target: { label: "node-id-1.runtime.zcp.zerops" } },
  connection: { phase, error: null },
  serverConfig: providers === null ? null : { providers },
});

const render = (
  listed: boolean,
  ...environments: ReadonlyArray<readonly [string, ReturnType<typeof environment>]>
) => {
  testState.presentations = new Map(
    environments.map(([id, entry]) => [EnvironmentId.make(id), entry]),
  );
  return renderToStaticMarkup(
    <RegistryContext.Provider value={registry}>
      <UsageLimitsSection identities={new Map()} listed={listed} now={0} />
    </RegistryContext.Provider>,
  );
};

describe("UsageLimitsSection: never none before every environment answered", () => {
  beforeEach(() => {
    testState.presentations = new Map();
  });

  it.each([
    ["no environment listed yet", () => render(false), READING_LIMITS_LINE],
    [
      "an environment still connecting",
      () => render(true, ["a", environment("connecting")]),
      READING_LIMITS_LINE,
    ],
    [
      "one answered without limits, another still connecting",
      () => render(true, ["a", environment("connected", [])], ["b", environment("connecting")]),
      READING_LIMITS_LINE,
    ],
    [
      "every environment answered without limits",
      () => render(true, ["a", environment("connected", [])]),
      NONE,
    ],
  ] as const)("%s", (_case, markup, says) => {
    const html = markup();
    expect(html).toContain(says);
    expect(html.includes(NONE)).toBe(says === NONE);
  });
});

it("missing Mate identity cannot establish that no account reports limits", () => {
  testState.presentations = new Map();
  const html = renderToStaticMarkup(
    <RegistryContext.Provider value={registry}>
      <UsageLimitsSection identities={new Map()} listed now={0} unavailableNames={["A"]} />
    </RegistryContext.Provider>,
  );
  expect(html).not.toContain(NONE);
  expect(html).toContain("Subscription limits could not be read");
});

it("Limits names coding agents and Mates when every read reports no subscription limits", () => {
  expect(render(true, ["a", environment("connected", [])])).toContain(
    "No coding agent on your connected Mates reports subscription limits.",
  );
});
