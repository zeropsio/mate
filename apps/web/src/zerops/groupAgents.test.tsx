import { RegistryContext } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { expect, it } from "vite-plus/test";

import { makeSampledAccount } from "./__fixtures__/sampledAccount";
import { useReadGroupAgents, type ReadGroupAgents } from "./groupAgents";
import { AccountDataContext } from "./ZeropsAccountData";

const environment = (serviceId: string | undefined) => ({
  item: { service: serviceId === undefined ? undefined : { id: serviceId } } as ZeropsCandidate,
});

/** Each service's variables as the platform answers them; a missing one refuses the read. */
const ENVS: Readonly<Record<string, ReadonlyArray<{ key: string; content: string }>>> = {
  dev: [{ key: "ZCP_AGENT_OAUTH_CODEX", content: "1" }],
  stage: [
    { key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true" },
    { key: "ZCP_AGENT_OAUTH_CODEX", content: "0" },
  ],
};

async function reader(): Promise<{ read: ReadGroupAgents; asked: () => ReadonlyArray<string> }> {
  const registry = AtomRegistry.make();
  const asked: string[] = [];
  const account = makeSampledAccount({
    registry,
    orgId: "org-1",
    answer: (path, search) => {
      const terms = (search?.search ?? []) as ReadonlyArray<{ name: string; value: unknown }>;
      const serviceId = String(terms.find((term) => term.name === "serviceStackId")?.value);
      asked.push(`${path} ${serviceId}`);
      const items = ENVS[serviceId];
      return Promise.resolve(
        items === undefined ? { status: 403, body: null } : { status: 200, body: { items } },
      );
    },
  });
  const readers: ReadGroupAgents[] = [];
  function Probe() {
    readers.push(useReadGroupAgents());
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
  return { read: readers.at(-1)!, asked: () => asked };
}

it.each([
  {
    name: "unions what each environment is signed in with",
    services: ["dev", "stage"],
    agents: ["claude-code", "codex"],
  },
  {
    name: "adds nothing for a read refused, nor for one without a container",
    services: ["dev", "gone", undefined],
    agents: ["codex"],
  },
  { name: "is none where no environment has a container", services: [undefined], agents: [] },
] as const)("$name", async ({ services, agents }) => {
  const { read, asked } = await reader();
  const answer = await read(services.map(environment));
  expect(answer).toEqual(agents);
  expect(asked().every((read) => read.startsWith("/user-data/search "))).toBe(true);
});

it("reads a group's agents once within their freshness, however many creations ask", async () => {
  const { read, asked } = await reader();
  await read([environment("dev")]);
  await read([environment("dev")]);
  expect(asked()).toEqual(["/user-data/search dev"]);
});
