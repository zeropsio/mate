// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { makeSampledAccount } from "./__fixtures__/sampledAccount";
import { useUsualAgent } from "./useUsualAgent";
import { AccountDataContext } from "./ZeropsAccountData";

/** A Mate of group `g1`, its container service `s-<id>`. */
const mate = (id: string) => ({
  key: `${id}:zcp`,
  project: {
    id,
    name: id,
    status: "ACTIVE",
    hq: { appId: "g1", appName: "Group", kind: "mate", mate: { name: id, face: "" } },
  },
  service: { id: `s-${id}`, name: "zcp", status: "ACTIVE" },
  group: "connected",
});
vi.mock("./useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({
    listing: { state: "known", value: ["own", "ada", "bo", "cy"].map(mate) },
  }),
}));

const flag = (agent: string) => ({ key: `ZCP_AGENT_OAUTH_${agent}`, content: "1" });

async function usual(
  envs: Readonly<Record<string, ReadonlyArray<{ key: string; content: string }> | "pending">>,
) {
  const registry = AtomRegistry.make();
  const account = makeSampledAccount({
    registry,
    orgId: "org-1",
    answer: (_path, search) => {
      const terms = (search?.search ?? []) as ReadonlyArray<{ name: string; value: unknown }>;
      const serviceId = String(terms.find((term) => term.name === "serviceStackId")?.value);
      const items = envs[serviceId.replace(/^s-/u, "")];
      if (items === "pending") return new Promise(() => undefined);
      return Promise.resolve(
        items === undefined ? { status: 403, body: null } : { status: 200, body: { items } },
      );
    },
  });
  const seen: Array<ReturnType<typeof useUsualAgent>> = [];
  function Probe() {
    seen.push(useUsualAgent("own"));
    return null;
  }
  await act(async () => {
    create(
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(AccountDataContext.Provider, { value: account }, createElement(Probe)),
      ),
    );
  });
  const first = seen.at(-1);
  return { first, last: () => seen.at(-1) };
}

it.each([
  {
    name: "the agent most of the other Mates are signed in with",
    envs: { ada: [flag("CODEX")], bo: [flag("CODEX"), flag("CLAUDE_CODE")], cy: [] },
    expected: { usual: "codex", settled: true },
  },
  {
    name: "a Mate whose read is refused, as one signed in with none",
    envs: { ada: [flag("CLAUDE_CODE")], cy: [] },
    expected: { usual: "claude-code", settled: true },
  },
  {
    name: "not settled while a Mate's read is under way",
    envs: { ada: [flag("CODEX")], bo: [], cy: "pending" },
    expected: { usual: "codex", settled: false },
  },
] as const)("is $name", async ({ envs, expected }) => {
  const { first, last } = await usual(envs);
  expect(first?.settled).toBe(false);
  await act(async () => {
    await vi.waitFor(() => expect(last()).toEqual(expected));
  });
});
