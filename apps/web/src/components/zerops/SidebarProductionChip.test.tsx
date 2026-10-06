import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useUiStateStore } from "~/uiStateStore";
import type { FixProblem } from "~/zerops/fixRequest";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";

import { ChipMenu, SidebarProductionChip, type ChipMate } from "./SidebarProductionChip";
import {
  productionMenu,
  stageMenu,
  type ChipMenuModel,
  type ProductionChip,
} from "./SidebarProductionChip.logic";

const heldDemand = vi.hoisted(
  () => [] as ReadonlyArray<import("@t3tools/client-runtime/zerops/data").ProjectRef>[],
);
vi.mock("~/zerops/accountForge", () => ({
  useStopDeployments: (
    refs: ReadonlyArray<import("@t3tools/client-runtime/zerops/data").ProjectRef>,
  ) => {
    heldDemand.push(refs);
    return new Map();
  },
  againStopDeployment: () => {},
  useStopDeploymentDemand: () => {},
}));
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import { ZeropsSessionContext } from "~/zerops/sessionContext";
import type { ZeropsSessionValue } from "~/zerops/ZeropsSessionProvider";
import { project as projectRef } from "~/zerops/__fixtures__/platformData";

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
  tint: ChipMate["tint"],
  mine: boolean | undefined,
): ChipMate {
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
      service: "app",
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
      route: undefined,
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

function menu(
  model: ChipMenuModel | ((nowMs: number) => ChipMenuModel),
  props: Partial<Parameters<typeof ChipMenu>[0]> = {},
) {
  return (
    <ChipMenu
      groupId="shop"
      mates={[ORSA]}
      menu={typeof model === "function" ? model : () => model}
      onAskToFix={() => {}}
      onOpenStop={() => undefined}
      projectName="Beviro"
      {...props}
    />
  );
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  useUiStateStore.setState({ threadLastVisitedAtById: {} });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(element: ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

function surface(tree: ReactTestRenderer, name: string): ReactTestInstance {
  return tree.root.find(
    (node) => typeof node.type === "string" && node.props["data-zerops-surface"] === name,
  );
}

/** Everything a node says, as text. */
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

function press(tree: ReactTestRenderer, name: string): void {
  act(() => {
    surface(tree, name).props.onClick();
  });
}

describe("a chip on the project's heading", () => {
  it("demands every project id the visible chip stands for, even when inventory has not named it", () => {
    heldDemand.length = 0;
    const data = {
      runtime: { scope: {} },
      projectRef: (_org: string, id: string) => projectRef(id),
    } as unknown as ZeropsDataContextValue;
    const session = { activeOrganization: { id: "org" } } as unknown as ZeropsSessionValue;
    renderToStaticMarkup(
      <ZeropsSessionContext value={session}>
        <ZeropsDataContext value={data}>
          <SidebarProductionChip
            chip={{ label: "prod", state: "unverified" }}
            groupId="shop"
            projectName="Shop"
            stops={["hidden-production"]}
            mates={[]}
            menu={() => ({ stops: [] }) as ChipMenuModel}
            onAskToFix={undefined}
            onOpenStop={() => undefined}
          />
        </ZeropsDataContext>
      </ZeropsSessionContext>,
    );
    expect(heldDemand.at(-1)?.map(({ projectId }) => projectId)).toEqual(["hidden-production"]);
  });

  const chipHtml = (chip: ProductionChip) =>
    renderToStaticMarkup(
      <SidebarProductionChip
        chip={chip}
        groupId="quillmark"
        mates={[]}
        menu={() => menuOf(chip)}
        onAskToFix={undefined}
        onOpenStop={() => undefined}
        projectName="Quillmark"
        stops={chip.label === "prod" ? ["quillmark-prod"] : ["quillmark-stage", "quillmark-qa"]}
      />,
    );

  // The word alone — no version, no dot, no extras (the owner, 2026-09-29:
  // "I'm not sure version here is needed, not sure the status icon is needed
  // either") — its whole ground turning when something is wrong, and its
  // accessible name the state in words.
  it.each([
    {
      name: "healthy",
      chip: { label: "prod", state: "ok", version: "v0.1.0" },
      tone: "neutral",
      words: "Production v0.1.0, healthy",
    },
    {
      name: "changes waiting",
      chip: { label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 },
      tone: "neutral",
      words: "Production v0.1.44, healthy",
    },
    {
      name: "releasing",
      chip: { label: "prod", state: "releasing", version: "v1.2.0", next: "v1.2.1" },
      tone: "neutral",
      words: "Production v1.2.0, releasing v1.2.1",
    },
    {
      name: "the last release failed: production still serves the one before",
      chip: { label: "prod", state: "failed", version: "v0.1.56" },
      tone: "neutral",
      words: "Production v0.1.56, healthy",
    },
    {
      name: "down",
      chip: { label: "prod", state: "down", version: "v2.3.0" },
      tone: "red",
      words: "Production is down",
    },
    {
      name: "stopped",
      chip: { label: "prod", state: "stopped", version: "v0.3.1" },
      tone: "off",
      words: "Production is stopped",
    },
    {
      name: "a stage whose last deploy failed",
      chip: { label: "stage", state: "failed", version: "main" },
      tone: "amber",
      words: "Stage main, the last deploy failed",
    },
  ] as const)("$name: one button, the word alone, its tone", ({ chip, tone, words }) => {
    const html = chipHtml(chip);
    const button = /<button[^>]*>(.*?)<\/button>/u.exec(html);
    expect(button?.[1]).toBe(chip.label);
    expect(button?.[0]).toContain(`aria-label="${words}"`);
    expect(button?.[0]).toContain(`data-tone="${tone}"`);
    expect(button?.[0]).toContain(`data-zerops-chip="${chip.label}"`);
    expect(html).not.toContain("zerops-envdot");
    expect(html).not.toContain("sidebar-production-menu");
  });

  it("names the stops it stands for, where a find in the jump box lands", () => {
    expect(chipHtml({ label: "stage", state: "ok", version: "main" })).toContain(
      'data-zerops-stops="quillmark-stage quillmark-qa"',
    );
  });
});

describe("production's menu", () => {
  it("says the project, production, what it serves, and its state", () => {
    const html = renderToStaticMarkup(menu(FAILED));
    expect(html).toContain(">Beviro</h5>");
    expect(html).toContain(">production</b>");
    expect(html).toContain(">v0.1.56</span>");
    expect(html).toContain('data-tone="amber">Release failed</span>');
    expect(html).toContain(
      ">Release v0.1.57 failed: The build step exited with code 2 while installing packages. v0.1.56 is still serving.</p>",
    );
  });

  it("holds production alone: the stages have a chip and a menu of their own", () => {
    const tree = mount(menu(HEALTHY));
    const rows = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props["data-zerops-surface"] === "sidebar-production-main",
    );
    expect(rows.map(text)).toEqual(["productionv0.1.0Healthy"]);
  });

  it("links every public route, in a new tab, and opens the project in Zerops", () => {
    const html = renderToStaticMarkup(menu(HEALTHY));
    expect(html).toContain('href="https://shop.example.com"');
    expect(html).toMatch(/data-zerops-surface="sidebar-production-link"[^>]*target="_blank"/u);
    expect(html).toContain('href="https://app.zerops.io/project/shop-prod"');
    expect(html).toContain("Open in Zerops");
  });

  // An address says where, not what answers there (the owner, 2026-09-29:
  // "shouldn't this show to which service it points?"). The service leads each
  // link as the routes menu writes it, with its port only where one service
  // answers on several.
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
  ])("names the service each link reaches: $name", ({ routes, rows }) => {
    const tree = mount(menu(menuOf({ label: "prod", state: "ok", version: "v0.1.0" }, { routes })));
    const links = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props["data-zerops-surface"] === "sidebar-production-link",
    );
    const words = (link: ReactTestInstance) =>
      link.children
        .flatMap((child) => (typeof child === "string" ? [child] : [text(child)]))
        .filter((each) => each.length > 0);
    expect(links.map(words)).toEqual(rows);
  });

  // S6: every problem offers its fix — only the person's own Mates, since
  // nobody writes to a colleague's, and only where something is broken.
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
  ])("offers the fix $name", ({ model, mates, ask }) => {
    const html = renderToStaticMarkup(menu(model, { mates }));
    if (ask === undefined) expect(html).not.toContain("to fix it");
    else expect(html).toContain(`>Ask ${ask} to fix it</button>`);
  });

  it("draws the Mate the fix goes to in the face its person picked", () => {
    const html = renderToStaticMarkup(menu(FAILED, { mates: [{ ...ORSA, shape: "clover" }] }));
    expect(html).toContain('data-mate-face-tint="sky" data-zerops-primitive="mate-face"');
    expect(html).toContain('data-mate-face-shape="clover"');
    expect(html).not.toContain('data-mate-face-shape="pick"');
  });

  it("offers the fix to the Mate used last first, and another from a small list", () => {
    useUiStateStore.setState({
      threadLastVisitedAtById: {
        "env-shop-orsa:thread-shop-orsa": "2026-09-29T08:00:00Z",
        "env-shop-ivet:thread-shop-ivet": "2026-09-29T10:00:00Z",
      },
    });
    const tree = mount(menu(FAILED, { mates: [ORSA, IVET] }));
    expect(text(surface(tree, "sidebar-production-ask-button"))).toContain("Ask Ivet to fix it");
    act(() => {
      tree.root
        .find((node) => node.props["aria-label"] === "Ask another of your Mates")
        .props.onClick();
    });
    act(() => {
      tree.root
        .find((node) => node.type === "button" && node.children.some((child) => child === "Orsa"))
        .props.onClick();
    });
    expect(text(surface(tree, "sidebar-production-ask-button"))).toContain("Ask Orsa to fix it");
  });

  it("shows what will be written before it goes, then writes it into the Mate's composer", () => {
    const asked: Array<[string, FixProblem]> = [];
    const tree = mount(
      menu(FAILED, {
        onAskToFix: (mateProjectId, problem) => {
          asked.push([mateProjectId, problem]);
        },
      }),
    );
    expect(() => surface(tree, "sidebar-production-draft")).toThrow();
    press(tree, "sidebar-production-ask-button");
    const draft = text(surface(tree, "sidebar-production-draft"));
    expect(draft).toContain("Opens Orsa's conversation with this in the composer");
    expect(draft).toContain("Production's release v0.1.57 failed deploying app.");
    expect(draft).toContain(
      "The error: The build step exited with code 2 while installing packages.",
    );
    expect(asked).toEqual([]);
    press(tree, "sidebar-production-ask-open");
    expect(asked).toEqual([["shop-orsa", PROBLEM]]);
  });

  it("opens the stop's own page from its row, where one opens", () => {
    const opened: string[] = [];
    const tree = mount(
      menu(HEALTHY, {
        onOpenStop: (projectId) => () => {
          opened.push(projectId);
        },
      }),
    );
    press(tree, "sidebar-production-main");
    expect(opened).toEqual(["shop-prod"]);
  });
});

describe("the stages' menu", () => {
  const rows = (tree: ReactTestRenderer, name: string) =>
    tree.root
      .findAll(
        (node) => typeof node.type === "string" && node.props["data-zerops-surface"] === name,
      )
      .map(text);

  // One stage reads as production's menu does: its row, its links, and Open
  // in Zerops last. What waits to go to production is the heading line's (D′).
  it("reads one stage as production's menu reads production", () => {
    const tree = mount(menu(stageMenu({ stages: [stageOf("stage")], creating: [], nowMs: 0 })));
    expect(rows(tree, "sidebar-production-main")).toEqual(["stage3f9c1b2Deployed"]);
    expect(rows(tree, "sidebar-production-link")).toEqual(["appstage.example.app"]);
    expect(rows(tree, "sidebar-production-waiting")).toEqual([]);
    const html = renderToStaticMarkup(
      menu(stageMenu({ stages: [stageOf("stage")], creating: [], nowMs: 0 })),
    );
    expect(html.match(/Open in Zerops/gu)).toHaveLength(1);
    expect(html).toContain('href="https://app.zerops.io/project/shop-stage"');
  });

  // The heading drew the chip long before anybody pressed it: the menu's ages
  // are as of the moment it opens.
  it("says how long ago a stage was deployed as of when it opens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:01:00Z"));
    const element = menu((nowMs) =>
      stageMenu({
        stages: [stageOf("stage", { deployedAt: "2026-09-29T09:00:00Z" })],
        creating: [],
        nowMs,
      }),
    );
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    const tree = mount(element);
    expect(text(surface(tree, "sidebar-production-main"))).toContain("Deployed 3 h ago");
  });

  it("holds several stages, each a group with its links, its fix and its own Open in Zerops", () => {
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
    const tree = mount(menu(model));
    expect(rows(tree, "sidebar-production-main")).toEqual([
      "stage3f9c1b2Deployed",
      "qa3f9c1b2Deploy failed",
    ]);
    expect(rows(tree, "sidebar-production-link")).toEqual([
      "appstage.example.app",
      "appqa.example.app",
    ]);
    expect(rows(tree, "sidebar-production-note")).toEqual([
      "The last deploy failed. 3f9c1b2 is still serving.",
    ]);
    expect(rows(tree, "sidebar-production-ask-button")).toEqual(["Ask Orsa to fix it"]);
    const zerops = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props["data-zerops-surface"] === "sidebar-production-zerops",
    );
    expect(zerops.map((link) => link.props.href)).toEqual([
      "https://app.zerops.io/project/shop-stage",
      "https://app.zerops.io/project/shop-qa",
    ]);
  });

  it("writes the fix for the stage it was offered under", () => {
    const asked: Array<[string, FixProblem]> = [];
    const tree = mount(
      menu(
        stageMenu({
          stages: [
            stageOf("qa", {
              chip: { label: "stage", state: "down", version: "main" },
              down: ["web"],
            }),
          ],
          creating: [],
          nowMs: 0,
        }),
        {
          onAskToFix: (mateProjectId, problem) => {
            asked.push([mateProjectId, problem]);
          },
        },
      ),
    );
    press(tree, "sidebar-production-ask-button");
    press(tree, "sidebar-production-ask-open");
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
