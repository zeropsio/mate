// @vitest-environment happy-dom
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { servicesAgents } from "@t3tools/client-runtime/data";
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { create } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { makeSampledAccount } from "./__fixtures__/sampledAccount";
import { useUsualAgent } from "./useUsualAgent";
import { AccountDataContext } from "./ZeropsAccountData";
import { ZeropsAgentSignIn } from "../components/zerops/ZeropsAgentSignIn";

vi.mock("./useZeropsFeeds", () => ({
  useZeropsAgentAuth: () => ({
    state: "known",
    freshness: { kind: "live" },
    value: {
      available: true,
      agents: (["claude-code", "codex"] as const).map((agentId) => ({
        agentId,
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        providerAuth: "unknown",
        state: "not-authorized",
      })),
    } satisfies ZeropsAgentAuthSnapshot,
  }),
}));
vi.mock("./useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ projectId: "own", orgId: "org-1" }),
}));
vi.mock("~/state/environments", () => ({ useEnvironment: () => undefined }));
vi.mock("./ZeropsSessionProvider", () => ({ useZeropsSessionOptional: () => null }));
vi.mock("./useZeropsMateOwners", () => ({ useHqPersonNames: () => () => undefined }));
vi.mock("./useAgentLogin", () => ({ useAgentLogin: () => () => {} }));
vi.mock("./useAgentLoginCancel", () => ({ useAgentLoginCancel: () => () => {} }));
vi.mock("./useAgentLoginSubmitCode", () => ({ useAgentLoginSubmitCode: () => () => {} }));

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((answer) => {
    resolve = answer;
  });
  return { promise, resolve };
}

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

it("shows the retained usual agent's sign-in cards immediately on remount during delayed refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const registry = AtomRegistry.make();
  const serviceIds = ["s-ada", "s-bo", "s-cy"];
  const refresh = new Map(
    serviceIds.map((id) => [id, deferred<{ status: number; body: unknown }>()]),
  );
  const started = deferred<void>();
  let refreshing = false;
  let refreshingReads = 0;
  const account = makeSampledAccount({
    registry,
    orgId: "org-1",
    answer: (_path, search) => {
      const terms = (search?.search ?? []) as ReadonlyArray<{ name: string; value: unknown }>;
      const serviceId = String(terms.find((term) => term.name === "serviceStackId")?.value);
      if (!serviceIds.includes(serviceId)) return null;
      if (!refreshing)
        return Promise.resolve({
          status: 200,
          body: { items: serviceId === "s-ada" ? [flag("CODEX")] : [] },
        });
      if (++refreshingReads === serviceIds.length) started.resolve();
      return refresh.get(serviceId)!.promise;
    },
  });
  const host = document.body.appendChild(document.createElement("div"));
  let root = createRoot(host);
  const wait = vi.spyOn(window, "setTimeout");
  const draw = () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <AccountDataContext.Provider value={account}>
          <ZeropsAgentSignIn environmentId={null} threadRef={null} mateName="Own" />
        </AccountDataContext.Provider>
      </RegistryContext.Provider>,
    );
  const cards = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button[data-agent-id]")].map(
      (card) => card.dataset.agentId,
    );
  try {
    await act(async () => draw());
    await act(async () => {
      expect(
        await Promise.all(
          serviceIds.map((ownerId) => account.readDetail({ family: "serviceAgents", ownerId })),
        ),
      ).toEqual([true, true, true]);
    });
    expect(cards()).toEqual(["codex", "claude-code"]);
    await act(async () => root.unmount());
    expect(
      registry.get(account.data.project(servicesAgents, { orgId: "org-1", serviceIds })),
    ).toMatchObject({
      "s-ada": { value: ["codex"], status: "ready", settled: false },
    });

    // Hold the card timeout while the account's Node timers continue to run.
    const waitHandle = setTimeout(() => undefined, 0);
    clearTimeout(waitHandle);
    wait.mockReturnValue(waitHandle);
    refreshing = true;
    for (const ownerId of serviceIds) account.revalidate({ family: "serviceAgents", ownerId });
    root = createRoot(host);
    await act(async () => draw());
    await started.promise;
    expect(
      registry.get(account.data.project(servicesAgents, { orgId: "org-1", serviceIds })),
    ).toMatchObject({
      "s-ada": { value: ["codex"], fact: { kind: "known" }, status: "loading", settled: false },
    });
    expect(cards()).toEqual(["codex", "claude-code"]);
    expect(host.querySelector('[data-agent-id="codex"] [data-usual-agent]')).not.toBeNull();
  } finally {
    await act(async () => {
      for (const [serviceId, answer] of refresh)
        answer.resolve({
          status: 200,
          body: { items: serviceId === "s-ada" ? [flag("CODEX")] : [] },
        });
      root.unmount();
    });
    wait.mockRestore();
    vi.unstubAllGlobals();
    host.remove();
    registry.dispose();
  }
});
