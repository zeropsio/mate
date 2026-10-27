// @vitest-environment happy-dom
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useUiStateStore } from "~/uiStateStore";
import type { FixProblem } from "~/zerops/fixRequest";

import {
  productionMenu,
  stageMenu,
  type ChipMenuModel,
  type ProductionChip,
} from "./SidebarProductionChip.logic";
import { SitesPanel, type ProjectSitesInput, type SitesMate } from "./SidebarProjectSites";

// The places of the globe's popover (`SitesPanel`), each drawn from the model production's and the
// stages' places are read into (`productionMenu`, `stageMenu`): what each says, its links, its
// fix and its way to Zerops. They were the heading's chips' menus until 2026-10-12.

vi.mock("~/zerops/accountForge", () => ({
  useStopDeploymentDemand: () => {},
  useStopDeployments: () => new Map(),
}));

const PROBLEM: FixProblem = {
  what: "Production's release v0.1.57 failed deploying app",
  at: undefined,
  error: "The build step exited with code 2 while installing packages.",
  ask: "v0.1.56 is still serving. Find out why, fix it, and release again.",
};

/** A Mate of the project `shop`, whose it is as given. */
function mate(
  id: string,
  bot: string,
  tint: SitesMate["tint"],
  mine: boolean | undefined,
): SitesMate {
  const candidate: ZeropsCandidate = {
    key: `${id}:zcp`,
    project: {
      id,
      name: bot,
      status: "ACTIVE",
      tagList: ["mate"],
      hq: { appId: "shop", appName: "Shop", kind: "mate", mate: { face: "" } },
    },
    group: "connected",
    environmentId: EnvironmentId.make(`env-${id}`),
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  };
  return {
    candidate,
    tint,
    shape: MATE_SHAPE_OF_TINT[tint],
    mine,
    threadKey: `env-${id}:thread-${id}`,
    name: bot,
    owner: undefined,
  };
}

const ORSA = mate("shop-orsa", "Orsa", "sky", true);
const PELL = mate("shop-pell", "Pell", "sand", false);
const IVET = mate("shop-ivet", "Ivet", "slate", true);
const BRAM = mate("shop-bram", "Bram", "violet", undefined);

const ROUTES = [
  { service: "app", port: 80, host: "shop.example.com", url: "https://shop.example.com" },
];

const menuOf = (chip: ProductionChip, over: Partial<Parameters<typeof productionMenu>[0]> = {}) =>
  productionMenu({
    chip,
    projectId: "shop-prod",
    failure: undefined,
    down: [],
    routes: ROUTES,
    nowMs: 0,
    ...over,
  });

const FAILED = menuOf(
  { label: "prod", state: "failed", version: "v0.1.56" },
  {
    failure: {
      tag: "v0.1.57",
      kind: "deploy-failed",
      at: undefined,
      error: "The build step exited with code 2 while installing packages.",
      services: ["app"],
    },
  },
);
const HEALTHY = menuOf({ label: "prod", state: "ok", version: "v0.1.0" });

/** A stage of the project `shop`, by its name. */
function stageOf(
  name: string,
  over: Partial<Parameters<typeof stageMenu>[0]["stages"][number]> = {},
): Parameters<typeof stageMenu>[0]["stages"][number] {
  return {
    projectId: `shop-${name}`,
    name,
    stop: {
      projectId: `shop-${name}`,
      name,
      state: "deployed",
      version: {
        name: undefined,
        commit: "3f9c1b2",
        sha: undefined,
        taggedBy: undefined,
        label: "3f9c1b2",
      },
      source: "main",
      addresses: [],
    },
    chip: { label: "stage", state: "ok", version: "main" },
    deployedAt: undefined,
    down: [],
    routes: [
      { service: "app", port: 80, host: `${name}.example.app`, url: `https://${name}.example.app` },
    ],
    ...over,
  };
}

type Model = ChipMenuModel | ((nowMs: number) => ChipMenuModel);
const modelOf = (model: Model | undefined) =>
  model === undefined ? undefined : typeof model === "function" ? model : () => model;

/** The popover's panel with production as `production` and the stages as `stages`. */
function panel(
  places: { readonly production?: Model; readonly stages?: Model },
  props: Partial<Parameters<typeof SitesPanel>[0]> = {},
): ReactElement {
  return (
    <SitesPanel
      focusSection={undefined}
      groupId="shop"
      line={undefined}
      mates={[ORSA]}
      onAskToFix={() => {}}
      onClose={() => {}}
      onOpenStop={() => undefined}
      onQuery={() => {}}
      production={modelOf(places.production) as ProjectSitesInput["production"]}
      projectName="Beviro"
      query=""
      stages={modelOf(places.stages) as ProjectSitesInput["stages"]}
      {...props}
    />
  );
}

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(element: ReactElement) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  unmounts.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  return container;
}

const all = (container: HTMLElement, name: string) => [
  ...container.querySelectorAll<HTMLElement>(`[data-zerops-surface="${name}"]`),
];
/** Each place's own way to Zerops; the Mates' sections hold theirs. */
const doors = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>(
    '[data-sites-place] [data-zerops-surface="sidebar-project-sites-zerops"]',
  ),
];
const one = (container: HTMLElement, name: string) => all(container, name)[0];
const texts = (container: HTMLElement, name: string) =>
  all(container, name).map((node) => node.textContent);

async function press(element: Element | undefined | null) {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("a place in the globe's popover", () => {
  it("says the project, production, what it serves, and its state", async () => {
    const container = await mount(panel({ production: FAILED }));
    expect(container.querySelector("h5")?.textContent).toBe("Beviro");
    const place = one(container, "sidebar-project-sites-place");
    expect(place?.querySelector("b")?.textContent).toBe("Production");
    expect(place?.textContent).toContain("v0.1.56");
    expect(place?.querySelector('[data-tone="amber"]')?.textContent).toBe("Release failed");
    expect(texts(container, "sidebar-project-sites-note")).toEqual([
      "Release v0.1.57 failed: The build step exited with code 2 while installing packages. v0.1.56 is still serving.",
    ]);
  });

  it("links every public route, in a new tab, and opens the project in Zerops", async () => {
    const container = await mount(panel({ production: HEALTHY }));
    const [link] = all(container, "sidebar-project-sites-link");
    expect(link?.getAttribute("href")).toBe("https://shop.example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(doors(container).map((door) => door.getAttribute("href"))).toEqual([
      "https://app.zerops.io/project/shop-prod",
    ]);
  });

  // An address says where, not what answers there (the owner, 2026-09-29: "shouldn't this show
  // to which service it points?"). The service leads each link as the routes menu writes it, with
  // its port only where one service answers on several.
  it.each([
    {
      name: "one service",
      routes: [
        { service: "app", port: 80, host: "shop.example.com", url: "https://shop.example.com" },
      ],
      rows: [["app", "shop.example.com"]],
    },
    {
      name: "two services",
      routes: [
        { service: "api", port: 80, host: "api.example.com", url: "https://api.example.com" },
        { service: "app", port: 80, host: "shop.example.com", url: "https://shop.example.com" },
      ],
      rows: [
        ["api", "api.example.com"],
        ["app", "shop.example.com"],
      ],
    },
    {
      name: "one service on two ports",
      routes: [
        { service: "api", port: 3000, host: "api-a.example.com", url: "https://api-a.example.com" },
        { service: "api", port: 8080, host: "api-b.example.com", url: "https://api-b.example.com" },
      ],
      rows: [
        ["api:3000", "api-a.example.com"],
        ["api:8080", "api-b.example.com"],
      ],
    },
  ])("names the service each link reaches: $name", async ({ routes, rows }) => {
    const container = await mount(
      panel({ production: menuOf({ label: "prod", state: "ok", version: "v0.1.0" }, { routes }) }),
    );
    expect(
      all(container, "sidebar-project-sites-link").map((link) => [
        link.querySelector(".zerops-sites-service")?.textContent,
        link.querySelector(".zerops-sites-host")?.textContent,
      ]),
    ).toEqual(rows);
  });

  // S6: every problem offers its fix — only the person's own Mates, since nobody writes to a
  // colleague's, and only where something is broken.
  it.each([
    { name: "in trouble, with an own Mate", model: FAILED, mates: [PELL, ORSA], ask: "Orsa" },
    { name: "in trouble, with none of theirs", model: FAILED, mates: [PELL], ask: undefined },
    {
      name: "in trouble, to a Mate nobody can say is someone else's",
      model: FAILED,
      mates: [PELL, BRAM],
      ask: "Bram",
    },
    { name: "healthy", model: HEALTHY, mates: [ORSA], ask: undefined },
  ])("offers the fix $name", async ({ model, mates, ask }) => {
    const container = await mount(panel({ production: model }, { mates }));
    expect(texts(container, "sidebar-production-ask-button")).toEqual(
      ask === undefined ? [] : [`Ask ${ask} to fix it`],
    );
  });

  it("draws the Mate the fix goes to in the face its person picked", async () => {
    const container = await mount(
      panel({ production: FAILED }, { mates: [{ ...ORSA, shape: "clover" }] }),
    );
    const face = one(container, "sidebar-production-ask-button")?.querySelector(
      '[data-zerops-primitive="mate-face"]',
    );
    expect(face?.getAttribute("data-mate-face-tint")).toBe("sky");
    expect(face?.getAttribute("data-mate-face-shape")).toBe("clover");
  });

  it("offers the fix to the Mate used last first, and another from a small list", async () => {
    useUiStateStore.setState({
      threadLastVisitedAtById: {
        "env-shop-orsa:thread-shop-orsa": "2026-09-29T08:00:00Z",
        "env-shop-ivet:thread-shop-ivet": "2026-09-29T10:00:00Z",
      },
    });
    const container = await mount(panel({ production: FAILED }, { mates: [ORSA, IVET] }));
    expect(one(container, "sidebar-production-ask-button")?.textContent).toBe("Ask Ivet to fix it");
    await press(container.querySelector('[aria-label="Ask another of your Mates"]'));
    await press(
      [...container.querySelectorAll('[aria-label="Your other Mates"] button')].find(
        (button) => button.textContent === "Orsa",
      ),
    );
    expect(one(container, "sidebar-production-ask-button")?.textContent).toBe("Ask Orsa to fix it");
  });

  it("shows what will be written before it goes, then writes it into the Mate's composer", async () => {
    const asked: Array<[string, FixProblem]> = [];
    const container = await mount(
      panel(
        { production: FAILED },
        {
          onAskToFix: (mateProjectId, problem) => {
            asked.push([mateProjectId, problem]);
          },
        },
      ),
    );
    expect(one(container, "sidebar-production-draft")).toBeUndefined();
    await press(one(container, "sidebar-production-ask-button"));
    const draft = one(container, "sidebar-production-draft")?.textContent ?? "";
    expect(draft).toContain("Opens Orsa's conversation with this in the composer");
    expect(draft).toContain("Production's release v0.1.57 failed deploying app.");
    expect(draft).toContain(
      "The error: The build step exited with code 2 while installing packages.",
    );
    expect(asked).toEqual([]);
    await press(one(container, "sidebar-production-ask-open"));
    expect(asked).toEqual([["shop-orsa", PROBLEM]]);
  });

  it("opens the stop's own page from its row, where one opens", async () => {
    const opened: string[] = [];
    const container = await mount(
      panel(
        { production: HEALTHY },
        {
          onOpenStop: (projectId) => () => {
            opened.push(projectId);
          },
        },
      ),
    );
    await press(one(container, "sidebar-project-sites-place"));
    expect(opened).toEqual(["shop-prod"]);
  });
});

describe("the stages in the globe's popover", () => {
  /** Each place's head as it reads: its name, what it serves, its word. */
  const heads = (container: HTMLElement) => texts(container, "sidebar-project-sites-place");
  const hosts = (container: HTMLElement) =>
    all(container, "sidebar-project-sites-link").map(
      (link) => link.querySelector(".zerops-sites-host")?.textContent,
    );

  it("reads one stage as it reads production: its head, its links, its own way to Zerops", async () => {
    const container = await mount(
      panel({ stages: stageMenu({ stages: [stageOf("stage")], creating: [], nowMs: 0 }) }),
    );
    expect(heads(container)).toEqual(["stage3f9c1b2Deployed"]);
    expect(hosts(container)).toEqual(["stage.example.app"]);
    expect(doors(container).map((door) => door.getAttribute("href"))).toEqual([
      "https://app.zerops.io/project/shop-stage",
    ]);
  });

  // The row was drawn long before anybody pressed its globe: the popover's ages are as of the
  // moment it opens.
  it("says how long ago a stage was deployed as of when it opens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T09:01:00Z"));
    const element = panel({
      stages: (nowMs) =>
        stageMenu({
          stages: [stageOf("stage", { deployedAt: "2026-09-29T09:00:00Z" })],
          creating: [],
          nowMs,
        }),
    });
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    const container = await mount(element);
    expect(heads(container)[0]).toContain("Deployed 3 h ago");
  });

  it("holds several stages, each a group with its links, its fix and its own Open in Zerops", async () => {
    const model = stageMenu({
      stages: [
        stageOf("stage"),
        stageOf("qa", {
          stop: { ...stageOf("qa").stop, state: "failed" },
          chip: { label: "stage", state: "failed", version: "main" },
        }),
      ],
      creating: [],
      nowMs: 0,
    });
    const container = await mount(panel({ stages: model }));
    expect(heads(container)).toEqual(["stage3f9c1b2Deployed", "qa3f9c1b2Deploy failed"]);
    expect(hosts(container)).toEqual(["stage.example.app", "qa.example.app"]);
    expect(texts(container, "sidebar-project-sites-note")).toEqual([
      "The last deploy failed. 3f9c1b2 is still serving.",
    ]);
    expect(texts(container, "sidebar-production-ask-button")).toEqual(["Ask Orsa to fix it"]);
    expect(doors(container).map((door) => door.getAttribute("href"))).toEqual([
      "https://app.zerops.io/project/shop-stage",
      "https://app.zerops.io/project/shop-qa",
    ]);
  });

  it("writes the fix for the stage it was offered under", async () => {
    const asked: Array<[string, FixProblem]> = [];
    const container = await mount(
      panel(
        {
          stages: stageMenu({
            stages: [
              stageOf("qa", {
                chip: { label: "stage", state: "down", version: "main" },
                down: ["web"],
              }),
            ],
            creating: [],
            nowMs: 0,
          }),
        },
        {
          onAskToFix: (mateProjectId, problem) => {
            asked.push([mateProjectId, problem]);
          },
        },
      ),
    );
    await press(one(container, "sidebar-production-ask-button"));
    await press(one(container, "sidebar-production-ask-open"));
    expect(asked).toEqual([
      [
        "shop-orsa",
        {
          what: "The qa stage is down: web failed on the platform",
          at: undefined,
          error: undefined,
          ask: "Find out why and bring it back.",
        },
      ],
    ]);
  });
});
