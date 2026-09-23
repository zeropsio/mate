import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { useAccountGitea, useAccountHoldsGitea } from "./giteaProject";
import { HeldInventoryContext, type InventoryServiceOutcome } from "./inventoryContext";

const gitea = {
  id: "gitea-1",
  clientId: "org-1",
  name: "gitea",
  status: "ACTIVE",
  tagList: ["mate:tool:gitea"],
} as ZeropsProject;

function Probe() {
  const found = useAccountGitea("org-1");
  return `${found?.projectId ?? "none"} held:${String(useAccountHoldsGitea("org-1"))}`;
}

const render = (services: ReadonlyMap<string, InventoryServiceOutcome>) =>
  renderToStaticMarkup(
    <HeldInventoryContext value={{ projects: [gitea], services }}>
      <Probe />
    </HeldInventoryContext>,
  );

describe("the account's Gitea", () => {
  // DESIGN law 5, M7: a grant that withholds the Gitea project alone leaves it out of every
  // shown read; the wiring that rests on it (the session, the registry, registration) stays.
  it("is found in the held inventory while the grant withholds its project", () => {
    expect(render(new Map([["gitea-1", { status: "resolved", services: [] }]]))).toBe(
      "gitea-1 held:true",
    );
  });

  // *Add Gitea* is offered against the project, not against its services being read.
  it("is held before its services are read, though not yet found", () => {
    expect(render(new Map())).toBe("none held:true");
  });
});
