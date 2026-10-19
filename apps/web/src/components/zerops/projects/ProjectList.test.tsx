import type * as React from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

const detailHolds = vi.hoisted(() => new Map<string, number>());
vi.mock("~/zerops/ZeropsAccountData", () => ({
  // Outside an account: a card has no detail to wait for, and paints at once.
  useAccountOrgId: () => null,
  useProjection: () => ({}),
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
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => 0, useSecondsNowMs: () => 0 }));

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
  brokenProduction,
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
import { create, type ReactTestRenderer } from "react-test-renderer";

import { PUT_LIVE_AFTER_CREATION } from "~/zerops/putLive.logic";

import { CardMateLiftActions } from "./ProjectCards";
import { ZeropsProjectsFlow } from "./ZeropsProjectsFlow";

/** The project `aaa`'s own page, with nothing beside its road. */
const PAGE = { groupId: "aaa", aside: null, unread: null } as const;

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
            previews: [],
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
    ["HQ's rule withholds its changes from this person", "unseen", "Changes show with Full access"],
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
                  previews: [],
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

describe("a card's production", () => {
  // The owner (2026-10-12): "why instead of 'no production' empty state not have a button to
  // setup prod".
  it("offers its setup where it has none and HQ offers it, and says it is not released where not", () => {
    const pressed: string[] = [];
    const none = entry([WREN]);
    const offered = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[none]}
        setUpProduction={({ group }) =>
          () => {
            pressed.push(group.groupId);
          }}
      />,
    );
    const button = offered.root.findAll(
      (node) => node.type === "button" && node.children.includes("Put it live"),
    );
    expect(button).toHaveLength(1);
    act(() => {
      button[0]!.props.onClick();
    });
    expect(pressed).toEqual(["aaa"]);
    const withheld = section(
      render({ groups: [none], setUpProduction: () => undefined }),
      'data-zerops-group="aaa"',
    );
    expect(withheld).not.toContain("Put it live");
    expect(withheld).toContain("Not released yet");
  });

  // The onboarding run: while a stage was being set up the button gave way to "Not released yet",
  // as if adding the stage had made a production too, and came back a minute later.
  it("keeps production's setup in its place while another environment is set up, not to be pressed", () => {
    const busy = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[entry([WREN])]}
        setUpProduction={() => "busy"}
      />,
    );
    const button = busy.root.findAll(
      (node) => node.type === "button" && node.children.includes("Put it live"),
    );
    expect(button.map((node) => node.props.disabled)).toEqual([true]);
    expect(
      section(
        render({ groups: [entry([WREN])], setUpProduction: () => "busy" }),
        'data-zerops-group="aaa"',
      ),
    ).toContain("Put it live");
  });
});

describe("production's setup while another environment is set up", () => {
  it("says why production's setup waits while another environment is set up", () => {
    const html = section(
      render({ groups: [entry([WREN])], setUpProduction: () => "busy" }),
      'data-zerops-group="aaa"',
    );
    expect(html).toContain(PUT_LIVE_AFTER_CREATION);
    expect(
      section(
        render({ groups: [entry([WREN])], setUpProduction: () => () => {} }),
        'data-zerops-group="aaa"',
      ),
    ).not.toContain(PUT_LIVE_AFTER_CREATION);
  });
});

describe("a card's release", () => {
  it("still offers the release beside a broken production, not just the build (D28)", () => {
    const html = section(render({ groups: [brokenProduction()] }), 'data-zerops-group="aaa"');
    expect(html).toContain("Release failed");
    expect(html).toContain('data-test-release-verb="true"');
  });
});

// The onboarding run: pressing Release took the release away and the card jumped 125 px.
describe("a card's release on its way", () => {
  const runs = {
    ...PRODUCTION_STOP,
    deployment: {
      state: "known",
      value: {
        kind: "running",
        activatedAt: null,
        version: {
          name: "v0.0.9",
          commit: "055a7e8",
          sha: undefined,
          taggedBy: undefined,
          label: "v0.0.9",
        },
      },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    },
  } as const;
  const release = {
    gate: { allowed: true } as const,
    suggestion: "v0.1.0",
    waiting: 1,
    waitingAtLeast: false,
    untold: [],
  };
  const ready = entry([WREN, PROD], {
    merged: [pull({ number: 4, merged: true })],
    stops: [runs],
    release,
  });
  const goingOut = entry([WREN, PROD], {
    merged: [pull({ number: 4, merged: true })],
    stops: [runs],
    release: {
      ...release,
      gate: { allowed: false, reason: "Releasing v0.1.0…" },
      inFlight: "v0.1.0",
    },
  });
  // The run's card said it twice: "Releasing v0.1.0" on production's line and "Putting v0.1.0
  // live" in a block of its own, with a "Releasing…" button (the owner, 2026-10-16).
  it("says a release on its way once, on production's line, with no block of its own", () => {
    const html = section(render({ groups: [goingOut] }), 'data-zerops-group="aaa"');
    expect(html).toContain("Releasing v0.1.0");
    expect(html).not.toContain("Putting v0.1.0 live");
    expect(html).not.toContain('data-test-release-verb="true"');
  });
  // The onboarding run: "Release" asked of the person while Put it live was making production.
  it("offers no release where the page's door is withheld, as while Put it live makes production", () => {
    expect(section(render({ groups: [ready] }), 'data-zerops-group="aaa"')).toContain(
      'data-zerops-card-ready="true"',
    );
    const html = section(
      render({ groups: [ready], renderReleaseVerb: () => null }),
      'data-zerops-group="aaa"',
    );
    expect(html).not.toContain('data-zerops-card-ready="true"');
  });
});

// The onboarding run: the owner searched 21 s for Add stage, which lived in the card's ··· menu.
describe("a card's stage", () => {
  it("offers adding a stage where the project has none, where the stage would stand", () => {
    const pressed: string[] = [];
    // On the project's page, where its road's Stage column stands, once it has a production (one
    // still in development offers its one next step instead); the card's ghost stop says only
    // that there is none.
    const offered = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[entry([WREN, PROD])]}
        page={PAGE}
        setUpStage={({ group }) =>
          () => {
            pressed.push(group.groupId);
          }}
      />,
    );
    const button = offered.root.findAll(
      (node) => node.type === "button" && node.children.includes("Add stage"),
    );
    expect(button).toHaveLength(1);
    act(() => {
      button[0]!.props.onClick();
    });
    expect(pressed).toEqual(["aaa"]);
    expect(
      section(render({ groups: [entry([WREN, PROD])], page: PAGE }), 'data-zerops-group="aaa"'),
    ).not.toContain("Add stage");
  });

  // r3: a change waiting for review stood in the side column's Changes, and a release's door in
  // production's head, in the Changes card and on production's row.
  it("asks for what needs the person once, above both columns, each with its one action", () => {
    const opened: number[] = [];
    const tree = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[
          entry([WREN, PROD], {
            pullRequests: [pull({ number: 7, title: "Gift cards at checkout" })],
            stops: [PRODUCTION_STOP],
          }),
        ]}
        openChange={(_entry, change) => {
          opened.push(change.number);
        }}
        page={PAGE}
      />,
    );
    const needs = tree.root.findByProps({ "data-zerops-surface": "project-needs" });
    const reviews = needs.findAll(
      (node) => node.type === "button" && node.children.includes("Review"),
    );
    expect(reviews).toHaveLength(1);
    act(() => {
      reviews[0]!.props.onClick({ currentTarget: null });
    });
    expect(opened).toEqual([7]);
    // The Mate's own row says its change no second time.
    expect(tree.root.findByProps({ "data-test-mate": "wren-dev" }).props["data-test-review"]).toBe(
      undefined,
    );
  });

  // r3, the owner: "especially when there is no prod and or stage, you didn't take in
  // consideration the empty state".
  it("reads a project with no production and no stage as in development, with one next step", () => {
    const html = render({
      groups: [entry([WREN])],
      page: PAGE,
      setUpStage: () => () => {},
    });
    expect(html).toContain('data-zerops-surface="project-development"');
    expect(html).toContain("Tell");
    expect(html).not.toContain('data-zerops-surface="project-places"');
    expect(html).not.toContain("Not released yet");
    expect(html).not.toContain("Add stage");
  });

  // The run's Add stage: its progress stood in a 1434 px card of its own at the page's foot, below
  // the fold, saying "Starting its services" while the Stage line above said "Deploying…".
  it.each([
    { case: "before the platform lists it", groups: [entry([WREN])] },
    {
      case: "once the platform lists it",
      groups: [entry([WREN, STAGE], { stops: [{ ...STAGE_STOP }] })],
    },
  ])("says a stage being added on its own line, where the stage stands: $case", ({ groups }) => {
    const html = section(
      render({
        groups,
        setUpStage: () => "busy",
        stageSettingUp: () => ({ step: "Starting the stage's services", startedAtMs: 0 }),
      }),
      'data-zerops-place="stage"',
    );
    expect(html).toContain("Starting the stage&#x27;s services");
    expect(html).not.toContain("Add stage");
    expect(html).not.toContain("Not deployed yet");
  });
});

// The onboarding run: an Admin who joined looked 11 s for a way to add their own Mate.
describe("a card's Mates", () => {
  it("closes with Add a Mate where the person may add one, and says why where it stands off", () => {
    // On the project's page, where Add Mate stands in its header (and the card's ··· holds it).
    const added: string[] = [];
    const open = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[entry([WREN])]}
        page={{
          ...PAGE,
          onAddMate: () => {
            added.push("aaa");
          },
        }}
      />,
    );
    const button = open.root.findAll(
      (node) => node.type === "button" && node.props["data-zerops-surface"] === "add-mate",
    );
    expect(button).toHaveLength(1);
    act(() => {
      button[0]!.props.onClick();
    });
    expect(added).toEqual(["aaa"]);
    const held = section(
      render({
        groups: [entry([WREN])],
        page: {
          ...PAGE,
          onAddMate: () => {},
          addMateWhy: "The project's setup files are not ready.",
        },
      }),
      'data-zerops-group="aaa"',
    );
    expect(held).toContain("The project&#x27;s setup files are not ready.");
    expect(
      section(render({ groups: [entry([WREN])], page: PAGE }), 'data-zerops-group="aaa"'),
    ).not.toContain('data-zerops-surface="add-mate"');
  });
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
  // A card says what its running release brought and where each merged change went (the owner,
  // 2026-10-11: "quick history of latest PRs"), which is the project's detail: read for the cards a
  // person can see, never for the whole organization at once.
  it.each([1, 12, 48])(
    "%i applications hold detail only for the cards in view, and let it go once out of view",
    (count) => {
      detailHolds.clear();
      const observers: Array<(seen: boolean) => void> = [];
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: IntersectionObserverCallback) {
            observers.push((seen) => {
              callback(
                [{ isIntersecting: seen } as IntersectionObserverEntry],
                this as unknown as IntersectionObserver,
              );
            });
          }
          observe() {}
          disconnect() {}
        },
      );
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const groups = Array.from({ length: count }, (_, index) => quiet(`app-${index}`));
      let tree: ReactTestRenderer | undefined;
      act(() => {
        // The row measures its scroll; a card is only observed.
        tree = create(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={groups} />, {
          createNodeMock: () => ({
            addEventListener: () => {},
            removeEventListener: () => {},
            scrollLeft: 0,
            scrollWidth: 0,
            clientWidth: 0,
          }),
        });
      });
      expect([...detailHolds]).toEqual([]);
      expect(observers).toHaveLength(count);
      act(() => observers[0]!(true));
      expect([...detailHolds]).toEqual([["app-0", 1]]);
      act(() => observers[0]!(false));
      expect([...detailHolds]).toEqual([]);
      act(() => tree?.unmount());
      vi.unstubAllGlobals();
    },
  );
});

describe("a lifted Mate's buttons", () => {
  const lifted = (lift: Parameters<typeof CardMateLiftActions>[0]["lift"], over = {}) => {
    const acted: Array<string> = [];
    const tree = mount(
      <CardMateLiftActions
        choices={[
          { label: "Stripe", primary: false, onPick: () => acted.push("pick:Stripe") },
          { label: "Adyen", primary: false, onPick: () => acted.push("pick:Adyen") },
        ]}
        lift={lift}
        name="Rhea"
        onApprove={() => acted.push("approve")}
        onFix={() => acted.push("fix")}
        onReply={(text) => acted.push(`reply:${text}`)}
        onReview={() => acted.push("review")}
        {...over}
      />,
    );
    const press = (label: string) =>
      act(() =>
        tree.root
          .findAll((node) => node.type === "button" && node.children.join("") === label)[0]!
          .props.onClick({ currentTarget: null }),
      );
    return { tree, acted, press };
  };

  it("answers a question by its options in place, beside Answer…", () => {
    const { acted, press, tree } = lifted({ kind: "question" });
    press("Adyen");
    expect(acted).toEqual(["pick:Adyen"]);
    expect(tree.root.findAll((node) => node.children.join("") === "Answer…")).not.toHaveLength(0);
  });

  it("approves a plan in place, and holds Approve plan while its plan is still being read", () => {
    const ready = lifted({ kind: "plan" });
    ready.press("Approve plan");
    expect(ready.acted).toEqual(["approve"]);
    const reading = lifted({ kind: "plan" }, { onApprove: undefined });
    const approve = reading.tree.root.findAll(
      (node) => node.type === "button" && node.children.join("") === "Approve plan",
    )[0]!;
    expect(approve.props.disabled).toBe(true);
  });
});
