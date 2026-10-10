import type * as React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

const detailHolds = vi.hoisted(() => new Map<string, number>());
vi.mock("~/zerops/ZeropsAccountData", () => ({
  useAccountDataOptional: () => ({
    demandDetail: ({ ownerId }: { readonly ownerId: string }) => {
      detailHolds.set(ownerId, (detailHolds.get(ownerId) ?? 0) + 1);
      return () => {
        const remaining = detailHolds.get(ownerId)! - 1;
        if (remaining === 0) detailHolds.delete(ownerId);
        else detailHolds.set(ownerId, remaining);
      };
    },
  }),
}));

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({
      to,
      params = {},
      ...props
    }: React.ComponentProps<"a"> & { to: string; params?: Record<string, string> }) =>
      createElement("a", {
        href: to.replace(/\$(\w+)/gu, (_, key: string) => params[key] ?? ""),
        ...props,
      }),
  };
});

// Base UI's tooltip reads `window` as it mounts, which a node render has none of: the trigger
// draws what it renders, and the hover it opens is not drawn.
vi.mock("~/components/ui/tooltip", async () => {
  const { cloneElement, Fragment, createElement } = await import("react");
  return {
    Tooltip: ({ children }: { readonly children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipTrigger: ({
      children,
      render,
    }: {
      readonly children: React.ReactNode;
      readonly render: React.ReactElement;
    }) => cloneElement(render, undefined, children),
    TooltipPopup: () => null,
  };
});

// A stop's one manual attempt reads the page's contexts; here it is the marker of a stop the row
// holds — the demand that reads what the stop runs.
vi.mock("../StopReadAgain", async () => {
  const { createElement } = await import("react");
  return {
    StopReadAgain: ({ projectId }: { readonly projectId: string }) =>
      createElement("i", { "data-test-again": projectId }),
  };
});

// The shared minute clock runs a window timer: a card reads a fixed now here.
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => 0 }));

// Base UI's popover portals out of a node render: here it draws its trigger, and its popup while
// open, in place.
vi.mock("~/components/ui/popover", async () => {
  const { cloneElement, createContext, createElement, Fragment, useContext } =
    await import("react");
  const Open = createContext<{ open: boolean; set: (open: boolean) => void }>({
    open: false,
    set: () => {},
  });
  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      readonly children: React.ReactNode;
      readonly open: boolean;
      readonly onOpenChange: (open: boolean) => void;
    }) => createElement(Open.Provider, { value: { open, set: onOpenChange } }, children),
    PopoverTrigger: ({
      children,
      render,
    }: {
      readonly children: React.ReactNode;
      readonly render: React.ReactElement;
    }) => {
      const { open, set } = useContext(Open);
      return cloneElement(render, { onClick: () => set(!open) } as never, children);
    },
    PopoverPopup: ({ children }: { readonly children: React.ReactNode }) =>
      useContext(Open).open ? createElement(Fragment, null, children) : null,
  };
});

import {
  born,
  entry,
  FLOW_PROPS,
  FRESH,
  item,
  MERGING,
  mount,
  placed,
  PROD,
  PRODUCTION_STOP,
  pull,
  renderFlow as render,
  section,
  STAGE,
  STAGE_STOP,
  VERA_COMING,
  WREN,
  type Item,
} from "./flowTestFixtures";
import { ZeropsProjectsFlow } from "./ZeropsProjectsFlow";

/** A quiet group of its own id: one Mate who was spoken to, nothing waiting. */
function quiet(groupId: string) {
  return entry([item(`${groupId}-dev`, placed(groupId, groupId))]);
}

describe("a project's row", () => {
  it("offers no verb on a row where nothing needs the person", () => {
    const row = section(render({ groups: [FRESH] }), 'data-zerops-group="bbb"');
    expect(row).toContain('data-test-mate="uma-dev"');
    expect(row).not.toContain("data-test-verb=");
    expect(row).not.toContain("data-test-release-verb=");
    expect(row).not.toContain("data-test-review=");
  });

  it("says nothing for nothing: no empty step words anywhere", () => {
    const html = render({
      groups: [MERGING, FRESH, entry([WREN, PROD], { stops: [PRODUCTION_STOP] })],
    });
    for (const word of [
      "None open",
      "None yet",
      "Not set up",
      "Nothing waiting to release",
      "Nothing merged",
      "No Mate yet",
      "Nothing needs you here",
    ]) {
      expect(html).not.toContain(word);
    }
  });

  it("never offers Add production in the row: the menu holds it", () => {
    const addable = entry([WREN], {
      mainHasCode: true,
    });
    const html = render({ groups: [addable] });
    expect(html).not.toContain("Add production");
    expect(html).not.toContain('data-test-verb="add-production"');
    expect(html).toContain('data-test-menu="aaa"');
  });

  it("holds its line while its reads are out, claiming nothing and offering nothing", () => {
    const unread = entry([WREN], { pullRequests: [pull()] }, false);
    const row = section(render({ groups: [unread] }), 'data-zerops-group="aaa"');
    expect(row).toContain('data-test-mate="wren-dev"');
    expect(row).not.toContain("waits for your merge");
    expect(row).not.toContain("data-test-review=");
    expect(row).not.toContain("data-test-verb=");
  });

  it("says a Mate stopped on an error before the reads answer: its own state decides it", () => {
    const stopped = entry(
      [WREN],
      {
        mates: [
          {
            projectId: "wren-dev",
            name: "Wren",
            preview: undefined,
            waiting: false,
            failed: true,
            talked: true,
          },
        ],
      },
      false,
    );
    const row = section(render({ groups: [stopped] }), 'data-zerops-group="aaa"');
    // Its own row says it, from its own reading, whatever the project's reads say yet.
    expect(row).toContain('data-test-mate="wren-dev"');
  });

  it.each([
    ["HQ did not answer for its changes", "failed", "HQ didn’t answer"],
    ["HQ's rule withholds its changes from this person", "unseen", "Needs Basic user access"],
  ] as const)(
    "says plainly why its changes are not known, offering nothing: %s",
    (_name, why, line) => {
      const unknown = { ...MERGING, changesUnknown: why };
      const row = section(render({ groups: [unknown] }), 'data-zerops-group="aaa"');
      expect(row).toContain(line);
      expect(row).not.toContain("waits for your merge");
      expect(row).not.toContain("data-test-review=");
      expect(row).not.toContain("data-test-verb=");
    },
  );

  it.each(["last Mate", "one of two Mates"])(
    "keeps HQ's unfinished deletion in view after deleting the %s",
    (which) => {
      const html = render({
        groups: [
          {
            ...FRESH,
            flow: { ...FRESH.flow, mates: which === "last Mate" ? [] : FRESH.flow.mates },
            mates: which === "last Mate" ? new Map() : FRESH.mates,
            contents: { empty: false, deletingProjectIds: ["zed"] },
          },
        ],
      });
      expect(section(html, 'data-zerops-group="bbb"')).toContain("Deletion is still in progress.");
      expect(html).not.toContain("No Mate yet");
    },
  );
});

describe("a row's Mates", () => {
  it("draws a Mate being created beside the listed one: waking, named, nothing to press", () => {
    const group = entry([WREN], { pullRequests: [pull()], pending: [VERA_COMING] });
    const row = section(
      render({ groups: [group], openMate: () => () => {} }),
      'data-zerops-group="aaa"',
    );
    expect(row).toContain('data-test-mate="wren-dev"');
    const at = row.indexOf('data-zerops-surface="mate-coming"');
    const coming = row.slice(row.lastIndexOf("<div", at));
    expect(coming).toContain('data-mate-face-state="waking"');
    expect(coming).toContain(">Vera<");
    expect(coming).not.toContain('aria-label="Open ');
  });

  it("draws a brand-new project's row from its birth alone", () => {
    expect(render({ groups: born([WREN]) })).toContain('data-zerops-group="ccc"');
  });

  // D7, one rule with the menu (`changeShowsReview`): while Wren works, its described changes
  // show no Review; at rest, they do.
  it.each([
    { case: "at work", working: true, review: undefined },
    { case: "at rest", working: false, review: 2 },
  ])(
    "shows its changes' Review by the rule the menu reads, its Mate $case",
    ({ working, review }) => {
      const tree = mount(
        <ZeropsProjectsFlow<Item>
          {...FLOW_PROPS}
          groups={[
            entry([WREN, STAGE], {
              mates: [
                {
                  projectId: "wren-dev",
                  name: "Wren",
                  preview: undefined,
                  waiting: false,
                  talked: true,
                  working,
                },
              ],
              pullRequests: [pull(), pull({ number: 2 })],
              stops: [STAGE_STOP],
            }),
          ]}
        />,
      );
      expect(
        tree.root.findByProps({ "data-test-mate": "wren-dev" }).props["data-test-review"],
      ).toBe(review);
    },
  );
});

describe("production's version", () => {
  const running = entry([WREN, PROD], {
    stops: [
      {
        ...PRODUCTION_STOP,
        deployment: {
          state: "known",
          value: {
            kind: "running",
            activatedAt: null,
            version: {
              name: "v0.1.9",
              commit: "055a7e8",
              sha: undefined,
              taggedBy: undefined,
              label: "v0.1.9",
            },
          },
          asOf: { ordinal: 1, atMs: 0 },
          coverage: "complete",
          freshness: { kind: "live" },
        },
      },
    ],
  });

  it("shows while the project's changes and releases are still being read", () => {
    const reading = { ...running, awaiting: true, changesAwaiting: true };
    const row = section(render({ groups: [reading] }), 'data-zerops-group="aaa"');
    expect(row).toContain(">v0.1.9<");
  });

  it("is nowhere without production", () => {
    const row = section(render({ groups: [MERGING] }), 'data-zerops-group="aaa"');
    expect(row).toContain("Not released yet");
    expect(row).not.toContain(">Running<");
  });
});

describe("a row's stops", () => {
  it("holds each one's read, opened or not: production's and every stage's", () => {
    const html = render({
      groups: [entry([WREN, STAGE, PROD], { stops: [STAGE_STOP, PRODUCTION_STOP] })],
    });
    const row = section(html, 'data-zerops-group="aaa"');
    expect(row).not.toContain('data-zerops-surface="place-panel"');
    expect(row.match(/data-test-again="fixture-prod"/gu)).toHaveLength(1);
    expect(row.match(/data-test-again="fixture-stage"/gu)).toHaveLength(1);
  });

  it("names a stop whose read failed, and what it says, beside its one attempt", () => {
    const failed = {
      ...STAGE_STOP,
      deployment: {
        state: "failed" as const,
        failure: { kind: "transport" as const, detail: "Zerops did not answer" },
        atMs: 1,
        attempt: 1,
        retryAtMs: null,
      },
    };
    const html = render({ groups: [entry([WREN, STAGE], { stops: [failed] })] });
    const stop = section(html, 'data-zerops-row-stop="fixture-stage"');
    expect(stop).toMatch(/>stage · [^<]+</u);
    expect(stop).toContain('data-test-again="fixture-stage"');
  });
});

describe("a row the page names (?group=)", () => {
  /** A document whose cards record each time they are scrolled into view. */
  function stubDocument() {
    const scrolled: Array<string> = [];
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("document", {
      getElementById: (id: string) => ({ scrollIntoView: () => scrolled.push(id) }),
    });
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      matchMedia: () => ({ matches: false }),
    });
    return { scrolled, interact: (type: string) => listeners.get(type)?.() };
  }
  const FOCUS = { ...FRESH, group: { ...FRESH.group, groupId: "fff" } };
  // A project whose card arrives before the named one as its reads answer.
  const ARRIVING = { ...quiet("ggg") };

  it("stays in view while rows above it rise as their reads answer", () => {
    const { scrolled } = stubDocument();
    const tree = mount(
      <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[FOCUS]} />,
    );
    expect(scrolled).toEqual(["project-fff"]);
    act(() =>
      tree.update(
        <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[ARRIVING, FOCUS]} />,
      ),
    );
    expect(scrolled).toEqual(["project-fff", "project-fff"]);
    vi.unstubAllGlobals();
  });

  it("lets the person's own scroll win", () => {
    const { scrolled, interact } = stubDocument();
    const tree = mount(
      <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[FOCUS]} />,
    );
    interact("wheel");
    act(() =>
      tree.update(
        <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[ARRIVING, FOCUS]} />,
      ),
    );
    expect(scrolled).toEqual(["project-fff"]);
    vi.unstubAllGlobals();
  });
});

describe("Projects detail demand", () => {
  it.each([1, 12, 48])(
    "%i collapsed applications hold no detail; opening one holds only its scope",
    (count) => {
      detailHolds.clear();
      const groups = Array.from({ length: count }, (_, index) => quiet(`app-${index}`));
      const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={groups} />);
      expect([...detailHolds]).toEqual([]);
      const card = tree.root.findByProps({ "data-zerops-group": "app-0" });
      const place = card.findByProps({ "data-zerops-place": "production" });
      act(() => place.props.onClick());
      expect([...detailHolds]).toEqual([["app-0", 1]]);
      act(() => place.props.onClick());
      expect([...detailHolds]).toEqual([]);
      act(() => tree.unmount());
    },
  );
});
