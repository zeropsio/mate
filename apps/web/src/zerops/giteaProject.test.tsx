import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  accountGiteaServices,
  useAccountGitea,
  useAccountGiteaServices,
  useAccountHoldsGitea,
} from "./giteaProject";
import {
  HeldInventoryContext,
  InventoryContext,
  type Inventory,
  type InventoryServiceOutcome,
} from "./inventoryContext";

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

describe("the account's Gitea project's services, for each group's runner", () => {
  const project = (id: string, status: string) =>
    ({ ...gitea, id, status, name: id }) as ZeropsProject;
  const runner = (status: string) => ({ id: `r-${status}`, name: "runnerbrine", status });
  it.each([
    {
      case: "an older project not active, listed first, gives way to the active one",
      projects: [project("old", "STOPPED"), project("new", "ACTIVE")],
      services: new Map<string, InventoryServiceOutcome>([
        ["old", { status: "resolved", services: [] }],
        ["new", { status: "resolved", services: [runner("ACTIVE")] }],
      ]),
      names: ["runnerbrine"],
    },
    {
      case: "a project whose services are unread is skipped",
      projects: [project("unread", "ACTIVE"), project("read", "ACTIVE")],
      services: new Map<string, InventoryServiceOutcome>([
        ["read", { status: "resolved", services: [runner("ACTIVE")] }],
      ]),
      names: ["runnerbrine"],
    },
    {
      case: "none read: unknown",
      projects: [project("unread", "ACTIVE")],
      services: new Map<string, InventoryServiceOutcome>(),
      names: undefined,
    },
  ])("$case", ({ projects, services, names }) => {
    expect(
      accountGiteaServices({ projects, services }, "org-1")?.map((service) => service.name),
    ).toEqual(names);
  });
});

describe("the runner's words read only what the grant shows (DESIGN law 5)", () => {
  function Services() {
    const services = useAccountGiteaServices("org-1");
    return services === undefined ? "unknown" : services.map(({ name }) => name).join(",");
  }
  const held = new Map<string, InventoryServiceOutcome>([
    [
      "gitea-1",
      { status: "resolved", services: [{ id: "r", name: "runnerbrine", status: "ACTIVE" }] },
    ],
  ]);
  it.each([
    { case: "shown", shown: held, says: "runnerbrine" },
    { case: "withheld from what renders: unknown", shown: new Map(), says: "unknown" },
  ])("$case", ({ shown, says }) => {
    expect(
      renderToStaticMarkup(
        <HeldInventoryContext value={{ projects: [gitea], services: held }}>
          <InventoryContext value={{ projects: [gitea], services: shown } as unknown as Inventory}>
            <Services />
          </InventoryContext>
        </HeldInventoryContext>,
      ),
    ).toBe(says);
  });
});
