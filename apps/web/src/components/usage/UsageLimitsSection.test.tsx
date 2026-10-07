import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  presentations: new Map<unknown, unknown>(),
}));

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAtomValue: () => testState.presentations,
}));
// The lines stand at once: their beat is the wait line's own to test.
vi.mock("~/zerops/useWaitLine", () => ({
  useWaitLine: (text: string | null) => text !== null,
}));
vi.mock("../zerops/WaitLine", () => ({
  WaitLine: ({ text }: { text: string }) => <p data-wait-line="">{text}</p>,
  PageWaitLine: ({ text }: { text: string | null }) => <p data-wait-line="">{text}</p>,
}));

import { READING_LIMITS_LINE, UsageLimitsSection } from "./UsageLimits";

const NONE = "No provider on a connected environment reports subscription limits.";

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
    <UsageLimitsSection identities={new Map()} listed={listed} now={0} />,
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
    <UsageLimitsSection identities={new Map()} listed now={0} unavailableNames={["A"]} />,
  );
  expect(html).not.toContain(NONE);
  expect(html).toContain("Subscription limits could not be read");
});
