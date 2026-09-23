import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const serverState = vi.hoisted(() => ({
  servers: new Map<string, { readonly environment: { readonly zerops?: unknown } }>(),
}));

vi.mock("../state/entities", () => ({
  useServerConfigs: () => serverState.servers,
}));

// No list read yet, and no cache from an earlier one.
vi.mock("../state/zerops", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  const { MATES_UNREAD } = await import("./mateIdentities");
  return { zeropsMatesAtom: Atom.make(MATES_UNREAD) };
});

import { useZeropsMate } from "./useZeropsMates";

const ENVIRONMENT = EnvironmentId.make("environment-1");

function WhoLivesAt() {
  return <>{useZeropsMate(ENVIRONMENT).kind}</>;
}

describe("useZeropsMate before the candidate list is read", () => {
  beforeEach(() => {
    serverState.servers.clear();
  });

  it.each<{
    readonly name: string;
    readonly environment: { readonly zerops?: unknown } | undefined;
    readonly kind: string;
  }>([
    { name: "a server that runs outside Zerops", environment: {}, kind: "nobody" },
    {
      name: "a server that runs in Zerops",
      environment: { zerops: { projectId: "project-1" } },
      kind: "unknown",
    },
    { name: "a server that has not answered", environment: undefined, kind: "unknown" },
  ])("reads $kind for $name", ({ environment, kind }) => {
    if (environment !== undefined) serverState.servers.set(ENVIRONMENT, { environment });

    expect(renderToStaticMarkup(<WhoLivesAt />)).toBe(kind);
  });
});
