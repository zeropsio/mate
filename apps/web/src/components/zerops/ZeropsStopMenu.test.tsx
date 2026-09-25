import type { ReleaseContentsSummary, ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import type { StopView } from "@t3tools/client-runtime/zerops/flow";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ZeropsStopMenu } from "./ZeropsStopMenu";

// The popup stands in a portal, and the unit suite has no document to put it
// in: every menu part renders in place, so the markup is what the popup holds.
vi.mock("../ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => children,
  MenuPopup: ({ children }: { children: ReactNode }) => children,
  MenuGroup: (props: Record<string, unknown>) => <div {...props} />,
  MenuGroupLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MenuSeparator: () => <hr />,
  MenuTrigger: (props: Record<string, unknown>) => <button type="button" {...props} />,
  MenuItem: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <div aria-disabled={disabled === true ? "true" : undefined}>{children}</div>
  ),
}));

const STOP: StopView = {
  tone: "good",
  word: "Deployed",
  line: "v1.4.0",
  version: {
    name: "v1.4.0",
    commit: "77ab0e1",
    sha: "77ab0e1c0ffee00000000000000000000000000",
    taggedBy: "ada",
    label: "v1.4.0",
  },
  afterMs: 0,
};

const menu = (
  props: Partial<{
    stop: StopView;
    routes: ReadonlyArray<ZeropsPublicRoute>;
    waiting: ReleaseContentsSummary | undefined;
    onOpenStop: (() => void) | undefined;
  }> = {},
) =>
  renderToStaticMarkup(
    <ZeropsStopMenu
      name="production"
      onOpenProject={() => undefined}
      onOpenStop={props.onOpenStop}
      routes={props.routes ?? []}
      stop={props.stop ?? STOP}
      triggerClassName="the-callers-hand"
      waiting={props.waiting}
    />,
  );

describe("ZeropsStopMenu", () => {
  it("is opened by a trigger named for the stop, in the caller's hand", () => {
    const html = menu();
    expect(html).toContain('aria-label="More for production"');
    expect(html).toContain('class="the-callers-hand"');
    expect(html).toContain('data-zerops-surface="stop-menu"');
  });

  it.each([
    ["a release, spelled out", STOP, "v1.4.0 · 77ab0e1 · tagged by ada"],
    [
      "a bare commit, once",
      {
        ...STOP,
        line: "77ab0e1",
        version: {
          name: undefined,
          commit: "77ab0e1",
          sha: STOP.version?.sha,
          taggedBy: undefined,
          label: "77ab0e1",
        },
      },
      "77ab0e1",
    ],
    [
      "the line while nothing is known",
      { ...STOP, line: "Checking what runs here…", version: undefined },
      "Checking what runs here…",
    ],
  ] as const)("says what runs: %s", (_case, stop, running) => {
    const html = menu({ stop });
    expect(html).toContain('data-zerops-surface="stop-menu-running"');
    expect(html).toContain("Running");
    expect(html).toContain(`<div aria-disabled="true">${running}</div>`);
  });

  it.each([
    ["offers its own page where there is one", () => undefined, true],
    ["offers none where there is none", undefined, false],
  ] as const)("%s", (_case, onOpenStop, offered) => {
    const html = menu({ onOpenStop });
    expect(html.includes("Open this environment")).toBe(offered);
    expect(html).toContain("Open in Zerops");
  });

  it("lists every public address, and none where nobody can reach it", () => {
    const routes: ReadonlyArray<ZeropsPublicRoute> = [
      {
        service: "app",
        port: 80,
        url: "https://app-26a7.prg1.zerops.app",
        host: "app-26a7.prg1.zerops.app",
      },
      {
        service: "api",
        port: 3000,
        url: "https://api-26a7-3000.prg1.zerops.app",
        host: "api-26a7-3000.prg1.zerops.app",
      },
    ];
    const html = menu({ routes });
    expect(html).toContain("app-26a7.prg1.zerops.app");
    expect(html).toContain("api-26a7-3000.prg1.zerops.app");
    expect(menu()).not.toContain('data-zerops-surface="public-routes"');
  });

  it.each([
    [
      "several, the rest counted",
      { subjects: ["Add a cart", "Fix the footer"], more: 1, total: 3 },
      ["3 changes waiting", "Add a cart", "Fix the footer", "+1 more"],
    ],
    ["one, in the singular", { subjects: ["Add a cart"], more: 0, total: 1 }, ["1 change waiting"]],
  ] as const)("lists the changes waiting: %s", (_case, waiting, words) => {
    const html = menu({ waiting });
    expect(html).toContain('data-zerops-surface="stop-menu-waiting"');
    for (const word of words) expect(html).toContain(word);
    expect(html.includes("more</div>")).toBe(waiting.more > 0);
  });

  it.each([
    ["on a stage", undefined],
    ["on a production nothing waits on", { subjects: [], more: 0, total: 0 }],
  ] as const)("lists no changes waiting %s", (_case, waiting) => {
    expect(menu({ waiting })).not.toContain('data-zerops-surface="stop-menu-waiting"');
  });
});
