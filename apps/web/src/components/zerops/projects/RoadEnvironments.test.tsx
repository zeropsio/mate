import { canonicalProjectFlow } from "@t3tools/client-runtime/data";
import {
  deployedVersion,
  environmentSlots,
  type CanonicalEnvironmentRow as EnvironmentRow,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { RegistryContext } from "@effect/atom-react";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { Window } from "happy-dom";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

import { devstagesOf, RoadEnvironmentRows, type RoadEnvironmentFacts } from "./RoadEnvironments";

const NOW = vi.hoisted(() => Date.parse("2026-09-25T12:00:00Z"));
/** What the platform answered of each stop, and where a row was opened to. */
const platform = vi.hoisted(() => ({
  deployments: new Map() as ReadonlyMap<string, unknown>,
  navigation: [] as Array<unknown>,
}));
vi.mock("~/zerops/projectFlows", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useStopDeploymentsShown: () => platform.deployments,
}));
vi.mock("~/zerops/ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("~/zerops/ZeropsSessionProvider")>()),
  useZeropsSession: () => ({ status: "signed-in", activeOrganization: { id: "org" } }),
}));
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({ status: "ready", hq: { kind: "official", address: "https://hq.test" } }),
}));
vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  useNavigate: () => (target: unknown) => {
    platform.navigation.push(target);
  },
}));
// A stop's one manual attempt reads the page's contexts; here it is only its marker.
vi.mock("../StopReadAgain", async () => {
  const { createElement } = await import("react");
  return {
    StopReadAgain: ({ projectId }: { readonly projectId: string }) =>
      createElement("i", { "data-test-again": projectId }),
  };
});

const CHECKING = "Checking your access to this project…";

const environment = (
  projectId: string,
  name: string,
  tier: EnvironmentRow["tier"] = "stage",
): EnvironmentRow =>
  ({
    id: HqEnvironmentId.make(projectId),
    target: { kind: "zerops", projectId: ProjectId.make(projectId) },
    name,
    tier,
    source: "main",
    tone: "good",
    version: {
      name: undefined,
      label: "3f9c1b2",
      commit: "3f9c1b2e",
      sha: "3f9c1b2e".padEnd(40, "0"),
      taggedBy: undefined,
    },
    versionRepository: undefined,
  }) as EnvironmentRow;

/** The road's rows as they stand for these environments and nothing else. */
const slotsOf = (environments: ReadonlyArray<EnvironmentRow>) =>
  environmentSlots({
    environments: environments.map((entry) => ({ id: entry.id, tier: entry.tier })),
    devstages: [],
    pending: [],
    halfMade: [],
    recipeTiers: [],
    recipeRead: false,
    offered: { stage: false, production: false },
    productionRuns: "unknown",
    waiting: { count: 0, atLeast: false },
    mainHasCode: undefined,
    releaseOffered: false,
    releasing: undefined,
  });

const RELEASE = {
  offered: false,
  releasing: false,
  tag: undefined,
  reason: undefined,
  onReview: () => {},
};

/** The road's Stage and Production columns' rows, side by side. */
function Road({ facts }: { readonly facts: RoadEnvironmentFacts }): ReactNode {
  return (
    <div>
      <RoadEnvironmentRows facts={facts} tier="stage" />
      <RoadEnvironmentRows facts={facts} tier="production" />
    </div>
  );
}

function render(
  stops: Pick<RoadEnvironmentFacts, "environments" | "withheldNotice" | "firstDeployOf"> & {
    readonly slots?: RoadEnvironmentFacts["slots"];
  } = {
    environments: [environment("stage", "stage"), environment("prod", "production", "production")],
  },
  /** What the platform answered of each stop; absent, nothing. */
  flow?: ReadonlyMap<string, Shown<Deployment>>,
) {
  platform.deployments = flow ?? new Map();
  return renderToStaticMarkup(
    <Road
      facts={{
        groupId: "shop",
        release: RELEASE,
        onAdd: () => {},
        ...stops,
        slots: stops.slots ?? slotsOf(stops.environments),
      }}
    />,
  );
}

describe("the road's stops", () => {
  it("draws every line's content", () => {
    const markup = render();

    expect(markup).toContain("stage");
    expect(markup).toContain("production");
    expect(markup).toContain("3f9c1b2");
  });

  // DESIGN §3.4, M7: a stop the grant withholds keeps its place on the road and nothing of its
  // project — neither its name, what it runs, nor a way into it.
  it("draws a stop the grant withholds as its tier and why", () => {
    const markup = render({
      environments: [
        environment("stage", "Shop stage"),
        {
          ...environment("prod", "Harbor live", "production"),
          version: {
            name: undefined,
            label: "9e8d7c6",
            commit: "9e8d7c6",
            sha: "9e8d7c6".padEnd(40, "0"),
            taggedBy: undefined,
          },
        },
      ],
      withheldNotice: (projectId) => (projectId === "prod" ? CHECKING : null),
    });

    expect(markup).toContain("production");
    expect(markup).toContain(CHECKING);
    expect(markup).not.toContain("Harbor live");
    expect(markup).not.toContain("9e8d7c6");
    expect(markup).toContain("3f9c1b2");
    expect(markup.match(/<button/g)?.length).toBe(render().match(/<button/g)!.length - 1);
  });

  describe("the Environments section", () => {
    const slots = (over: Partial<Parameters<typeof environmentSlots>[0]>) =>
      environmentSlots({
        environments: [],
        devstages: [],
        pending: [],
        halfMade: [],
        recipeTiers: ["stage", "production"],
        recipeRead: true,
        offered: { stage: true, production: true },
        productionRuns: "unknown",
        waiting: { count: 0, atLeast: false },
        mainHasCode: true,
        releaseOffered: false,
        releasing: undefined,
        ...over,
      });

    it("is not drawn before HQ's environments are read: nothing is known to be absent", () => {
      const markup = render({ environments: [], slots: [] });
      expect(markup).not.toContain("data-zerops-road-environments");
      expect(markup).not.toContain("Not added");
    });

    it("is there with nothing added: two quiet slots, each with its Add", () => {
      const markup = render({ environments: [], slots: slots({}) });
      expect(markup).toContain('data-zerops-road-environments="stage"');
      expect(markup).toContain('data-zerops-road-environments="production"');
      expect(markup).toContain("Add stage");
      expect(markup).toContain("Put it live");
    });

    it("offers no Add HQ does not offer, and says a tier waits for the recipe", () => {
      const markup = render({
        environments: [],
        slots: slots({ offered: { stage: false, production: false }, recipeTiers: ["stage"] }),
      });
      expect(markup).not.toContain("Add stage");
      expect(markup).toContain("Waiting for the Mate&#x27;s recipe");
    });

    describe("B: authoritative placement", () => {
      it("a Mate used as stage occupies the stage slot and explains who deploys it", () => {
        const devstages = devstagesOf("shop", [
          {
            id: "Juno",
            name: "Juno",
            status: "ACTIVE",
            hq: { appId: "shop", appName: "Shop", kind: "devstage", mate: { face: "" } },
          } as never,
        ]);
        const markup = render({ environments: [], slots: slots({ devstages }) });
        expect(markup).toContain("Juno — deployed by its agent");
        expect(markup).not.toContain("Add stage");
        expect(markup).toContain("Put it live");
      });
    });

    it("says a Mate that is the stage is the stage, and asks no second one of the person", () => {
      const markup = render({
        environments: [],
        slots: slots({ devstages: [{ id: "dev", name: "Vera" }] }),
      });
      expect(markup).toContain("Vera — deployed by its agent");
      expect(markup).not.toContain("Add stage");
      expect(markup).toContain("Put it live");
    });

    it("says a production being created is being set up, and offers no second Add for it", () => {
      const markup = render({
        environments: [],
        slots: slots({ pending: [{ id: "p-new", tier: "production" }] }),
      });
      expect(markup).toContain("Setting up production…");
      expect(markup).not.toContain("Put it live");
    });

    it("says an empty production waits for its first release, with Review release where offered", () => {
      const prod = environment("prod", "production", "production");
      const markup = render({
        environments: [prod],
        slots: slots({
          environments: [{ id: "prod", tier: "production" }],
          recipeTiers: [],
          productionRuns: "empty",
          releaseOffered: true,
        }),
      });
      expect(markup).toContain("No release yet");
      expect(markup).not.toContain("Put it live");
    });
  });

  it("says an empty stage's first deploy on its line, as its cell does", () => {
    const empty = {
      ...environment("stage", "stage"),
      version: { ...environment("stage", "stage").version, label: undefined, commit: undefined },
    } as EnvironmentRow;
    const markup = render({
      environments: [empty],
      firstDeployOf: (projectId) => (projectId === "stage" ? { kind: "on-its-way" } : undefined),
    });
    expect(markup).toContain("First deploy on its way");
  });

  // F13, 2026-10-03: a stage whose version was still being read wrote "none" in its version column,
  // while its page said it was checking.
  describe("names what a stop runs in its version column, as its page does", () => {
    const unnamed = {
      ...environment("stage", "stage"),
      version: { ...environment("stage", "stage").version, label: undefined, commit: undefined },
      tone: "neutral",
    } as EnvironmentRow;
    const running = (name: string): Shown<Deployment> => ({
      state: "known",
      value: { kind: "running", activatedAt: null, version: deployedVersion(name) },
      asOf: { ordinal: 1, atMs: NOW },
      coverage: "complete",
      freshness: { kind: "live" },
    });
    const UNREAD: Shown<Deployment> = { state: "unread", waitingFor: null };
    const NONE: Shown<Deployment> = {
      state: "known",
      value: { kind: "none" },
      asOf: { ordinal: 1, atMs: NOW },
      coverage: "complete",
      freshness: { kind: "live" },
    };

    it.each([
      {
        name: "checking while nothing has answered",
        deployment: undefined,
        expected: "Checking what runs here…",
      },
      {
        name: "checking while what runs is read",
        deployment: UNREAD,
        expected: "Checking what runs here…",
      },
      {
        name: "the version the platform names before the row does",
        deployment: running("main 6aeae99"),
        expected: "6aeae99",
      },
      {
        name: "none once the platform says nothing runs",
        deployment: NONE,
        expected: "Nothing deployed yet",
      },
    ])("$name", ({ deployment, expected }) => {
      const markup = render(
        { environments: [unnamed] },
        new Map(deployment === undefined ? [] : [["stage", deployment]]),
      );
      const document = new Window().document;
      document.body.innerHTML = markup;
      const row = Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.startsWith("stage"),
      );
      expect(row?.textContent).toContain(expected);
    });
  });
});

it("names a Mate that is also the stage, and no other project, as the group's devstage", () => {
  const project = (id: string, kind: "mate" | "devstage" | "stage", appId = "shop") =>
    ({
      id,
      name: id,
      status: "ACTIVE",
      hq: { appId, appName: "Shop", kind, mate: null },
    }) as never;
  expect(
    devstagesOf("shop", [
      project("vera", "devstage"),
      project("juno", "mate"),
      project("shop-stage", "stage"),
      project("other-dev", "devstage", "links"),
    ]),
  ).toEqual([{ id: "vera", name: "vera" }]);
});

it("Environment navigation keeps its identity when the target's project name changes.", () => {
  const id = HqEnvironmentId.make("stable-environment");
  const target = {
    kind: "zerops" as const,
    projectId: ProjectId.make("different-project-address"),
  };
  const open = (name: string) => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, "org", [
      { id: target.projectId, name: `Shop - ${name}`, status: "ACTIVE" },
    ]);
    mountHqNavigation(
      registry,
      "org",
      {
        structure: {
          ungrouped: [],
          apps: [
            {
              id: "shop",
              name: "Shop",
              projects: [],
              environments: [
                {
                  id,
                  target,
                  name: "Stage",
                  tier: "stage",
                  sources: ["main"],
                  order: 1,
                  keyHeld: false,
                  keyInvalid: false,
                  jobs: [],
                },
              ],
            },
          ],
        },
      },
      store,
    );
    const answer = registry.get(
      store.data.project(canonicalProjectFlow, {
        orgId: "org",
        appId: "shop",
        hqAddress: undefined,
        viewer: { id: "org", name: "Org", membershipId: "owner", roleCode: "OWNER" },
      }),
    );
    const row = answer!.environments[0]!;
    expect(row.name).toBe(name);
    expect(row.id).toBe("stable-environment");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let mounted!: ReactTestRenderer;
    act(() => {
      mounted = create(
        <RegistryContext.Provider value={registry}>
          <Road
            facts={{
              groupId: "shop",
              environments: [row],
              slots: slotsOf([row]),
              release: RELEASE,
              onAdd: () => {},
            }}
          />
        </RegistryContext.Provider>,
      );
    });
    const button = mounted.root
      .findAllByType("button")
      .find((node) => node.findAllByType("span").some((span) => span.children.includes(name)));
    expect(button).toBeDefined();
    act(() => button!.props.onClick());
    act(() => mounted.unmount());
    registry.dispose();
  };
  platform.navigation = [];
  open("Original project name");
  open("Renamed project name");
  expect(platform.navigation).toEqual([
    {
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "stable-environment" },
    },
    {
      to: "/group/$groupId/$projectId",
      params: { groupId: "shop", projectId: "stable-environment" },
    },
  ]);
});
