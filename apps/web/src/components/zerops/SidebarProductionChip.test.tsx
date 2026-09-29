import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useUiStateStore } from "~/uiStateStore";
import type { FixProblem } from "~/zerops/fixRequest";
import { ReviewContext, type ReviewTarget } from "~/zerops/review";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";

import { ProductionMenu, SidebarProductionChip, type ChipMate } from "./SidebarProductionChip";
import { chipMenu, type ChipMenuModel, type ProductionChip } from "./SidebarProductionChip.logic";

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
      name: `${bot} - dev`,
      status: "ACTIVE",
      tagList: ["mate", "mate:g:shop", "mate:role:dev", `mate:bot:${bot}`],
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

const menuOf = (chip: ProductionChip, over: Partial<Parameters<typeof chipMenu>[0]> = {}) =>
  chipMenu({ chip, failure: undefined, down: [], stages: [], waiting: 0, nowMs: 0, ...over });

const FAILED = menuOf({ label: "prod", state: "failed", version: "v0.1.56" });
const HEALTHY = menuOf({ label: "prod", state: "ok", version: "v0.1.0" });

function menu(
  model: ChipMenuModel | ((nowMs: number) => ChipMenuModel),
  props: Partial<Parameters<typeof ProductionMenu>[0]> = {},
) {
  return (
    <ProductionMenu
      fixProblem={PROBLEM}
      groupId="shop"
      mates={[ORSA]}
      menu={typeof model === "function" ? model : () => model}
      onAskToFix={() => {}}
      onOpenStop={undefined}
      onReview={() => {}}
      projectName="Beviro"
      reviewFrom={{ current: null }}
      routes={[
        { service: "app", port: 80, host: "shop.example.com", url: "https://shop.example.com" },
      ]}
      stopProjectId="shop-prod"
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

describe("the production chip", () => {
  it("is one button on the heading, its words the state's, its menu closed until pressed", () => {
    const html = renderToStaticMarkup(
      <SidebarProductionChip
        chip={{ label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 }}
        fixProblem={undefined}
        groupId="quillmark"
        mates={[]}
        menu={() => menuOf({ label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 })}
        onAskToFix={undefined}
        onOpenStop={undefined}
        projectName="Quillmark"
        routes={[]}
        stopProjectId="quillmark-prod"
      />,
    );
    expect(html).toContain('aria-label="Production v0.1.44, 1 change waiting"');
    expect(html).toContain(">· 1 waiting</span>");
    expect(html).not.toContain("sidebar-production-menu");
  });
});

describe("the production chip's menu", () => {
  it("says the project, production, what it serves, and its state", () => {
    const html = renderToStaticMarkup(menu(FAILED));
    expect(html).toContain(">Beviro</h5>");
    expect(html).toContain(">production</b>");
    expect(html).toContain(">v0.1.56</span>");
    expect(html).toContain('data-tone="amber">Release failed</span>');
    expect(html).toContain(">The last deploy failed. v0.1.56 is still serving.</p>");
  });

  // The heading drew the chip long before anybody pressed it: the menu's ages
  // are as of the moment it opens.
  it("says how long ago each stage was deployed as of when it opens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:01:00Z"));
    const element = menu((nowMs) =>
      chipMenu({
        chip: { label: "prod", state: "ok", version: "v0.1.0" },
        failure: undefined,
        down: [],
        stages: [
          {
            name: "stage",
            stop: {
              projectId: "shop-stage",
              name: "stage",
              state: "deployed",
              version: undefined,
              source: "main",
              route: undefined,
            },
            deployedAt: "2026-09-29T09:00:00Z",
          },
        ],
        waiting: 0,
        nowMs,
      }),
    );
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    const tree = mount(element);
    expect(text(surface(tree, "sidebar-production-stage"))).toContain("Deployed 3 h ago");
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
    const tree = mount(menu(HEALTHY, { routes }));
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

  it("counts what waits for production, and Review opens the release", () => {
    const opened: ReviewTarget[] = [];
    const tree = mount(
      <ReviewContext value={(target) => opened.push(target)}>
        {menu(
          menuOf(
            { label: "prod", state: "waiting", version: "v0.1.44", waiting: 2 },
            { waiting: 2 },
          ),
          { groupId: "quillmark" },
        )}
      </ReviewContext>,
    );
    expect(text(surface(tree, "sidebar-production-waiting"))).toContain(
      "2 changes wait for production",
    );
    press(tree, "sidebar-production-review");
    expect(opened).toEqual([{ kind: "release", groupId: "quillmark" }]);
  });

  it("offers no Review where nothing waits", () => {
    expect(renderToStaticMarkup(menu(HEALTHY))).not.toContain("sidebar-production-review");
  });

  it("opens the stop's own page from its row, where one opens", () => {
    let opened = 0;
    const tree = mount(
      menu(HEALTHY, {
        onOpenStop: () => {
          opened += 1;
        },
      }),
    );
    press(tree, "sidebar-production-main");
    expect(opened).toBe(1);
  });

  it("lists the stages under production, each with when it was deployed", () => {
    const html = renderToStaticMarkup(
      menu(
        menuOf(
          { label: "prod", state: "ok", version: "v0.1.44" },
          {
            stages: [
              {
                name: "stage",
                stop: {
                  projectId: "stage",
                  name: "stage",
                  state: "deployed",
                  version: {
                    name: "v0.1.45",
                    commit: "3f9c1b2",
                    sha: undefined,
                    taggedBy: undefined,
                    label: "v0.1.45",
                  },
                  source: "main",
                  route: undefined,
                },
                deployedAt: new Date(-40 * 60_000).toISOString(),
              },
            ],
          },
        ),
      ),
    );
    expect(html).toMatch(
      /data-zerops-surface="sidebar-production-stage".*>stage<\/b>.*>v0\.1\.45<\/span>.*>Deployed 40 min ago</u,
    );
  });
});
