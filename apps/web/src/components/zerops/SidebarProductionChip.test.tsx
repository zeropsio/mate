import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useUiStateStore } from "~/uiStateStore";
import type { FixProblem } from "~/zerops/fixRequest";
import { ReviewContext, type ReviewTarget } from "~/zerops/review";

import { ProductionMenu, SidebarProductionChip, type FixMateOption } from "./SidebarProductionChip";
import { chipMenu, type ChipMenuModel, type ProductionChip } from "./SidebarProductionChip.logic";

const PROBLEM: FixProblem = {
  what: "Production's release v0.1.57 failed deploying app",
  at: undefined,
  error: "Build pipeline failed; no recognised log pattern matched.",
  ask: "v0.1.56 is still serving. Find out why, fix it, and release again.",
};

const JUNO: FixMateOption = {
  mateProjectId: "shop-juno",
  name: "Juno",
  tint: "sky",
  mine: true,
  threadKey: "env-juno:thread-juno",
};
const CLEO: FixMateOption = {
  mateProjectId: "shop-cleo",
  name: "Cleo",
  tint: "sand",
  mine: false,
  threadKey: "env-cleo:thread-cleo",
};
const NOVA: FixMateOption = {
  mateProjectId: "shop-nova",
  name: "Nova",
  tint: "slate",
  mine: true,
  threadKey: "env-nova:thread-nova",
};

const menuOf = (chip: ProductionChip, over: Partial<Parameters<typeof chipMenu>[0]> = {}) =>
  chipMenu({ chip, failure: undefined, down: [], stages: [], waiting: 0, nowMs: 0, ...over });

const FAILED = menuOf({ label: "prod", state: "failed", version: "v0.1.56" });
const HEALTHY = menuOf({ label: "prod", state: "ok", version: "v0.1.0" });

function menu(model: ChipMenuModel, props: Partial<Parameters<typeof ProductionMenu>[0]> = {}) {
  return (
    <ProductionMenu
      fixProblem={PROBLEM}
      groupId="shop"
      mates={[JUNO]}
      menu={model}
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
        groupId="letopis"
        mates={[]}
        menu={menuOf({ label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 })}
        onAskToFix={undefined}
        onOpenStop={undefined}
        projectName="Letopis"
        routes={[]}
        stopProjectId="letopis-prod"
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

  it("links every public route, in a new tab, and opens the project in Zerops", () => {
    const html = renderToStaticMarkup(menu(HEALTHY));
    expect(html).toContain('href="https://shop.example.com"');
    expect(html).toMatch(/data-zerops-surface="sidebar-production-link"[^>]*target="_blank"/u);
    expect(html).toContain('href="https://app.zerops.io/project/shop-prod"');
    expect(html).toContain("Open in Zerops");
  });

  // S6: every problem offers its fix — only the person's own Mates, since
  // nobody writes to a colleague's, and only where something is broken.
  it.each([
    { name: "in trouble, with an own Mate", model: FAILED, mates: [CLEO, JUNO], ask: "Juno" },
    { name: "in trouble, with none of theirs", model: FAILED, mates: [CLEO], ask: undefined },
    { name: "healthy", model: HEALTHY, mates: [JUNO], ask: undefined },
  ])("offers the fix $name", ({ model, mates, ask }) => {
    const html = renderToStaticMarkup(menu(model, { mates }));
    if (ask === undefined) expect(html).not.toContain("to fix it");
    else expect(html).toContain(`>Ask ${ask} to fix it</button>`);
  });

  it("offers the fix to the Mate used last first, and another from a small list", () => {
    useUiStateStore.setState({
      threadLastVisitedAtById: {
        "env-juno:thread-juno": "2026-09-29T08:00:00Z",
        "env-nova:thread-nova": "2026-09-29T10:00:00Z",
      },
    });
    const tree = mount(menu(FAILED, { mates: [JUNO, NOVA] }));
    expect(text(surface(tree, "sidebar-production-ask-button"))).toContain("Ask Nova to fix it");
    act(() => {
      tree.root
        .find((node) => node.props["aria-label"] === "Ask another of your Mates")
        .props.onClick();
    });
    act(() => {
      tree.root
        .find((node) => node.type === "button" && node.children.some((child) => child === "Juno"))
        .props.onClick();
    });
    expect(text(surface(tree, "sidebar-production-ask-button"))).toContain("Ask Juno to fix it");
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
    expect(draft).toContain("Opens Juno's conversation with this in the composer");
    expect(draft).toContain("Production's release v0.1.57 failed deploying app.");
    expect(draft).toContain("The error: Build pipeline failed; no recognised log pattern matched.");
    expect(asked).toEqual([]);
    press(tree, "sidebar-production-ask-open");
    expect(asked).toEqual([["shop-juno", PROBLEM]]);
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
          { groupId: "letopis" },
        )}
      </ReviewContext>,
    );
    expect(text(surface(tree, "sidebar-production-waiting"))).toContain(
      "2 changes wait for production",
    );
    press(tree, "sidebar-production-review");
    expect(opened).toEqual([{ kind: "release", groupId: "letopis" }]);
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
