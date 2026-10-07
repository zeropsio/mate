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
  UMA,
  VERA_COMING,
  WREN,
  type Item,
} from "./flowTestFixtures";
import { ZeropsProjectsFlow } from "./ZeropsProjectsFlow";

/** The rows' order, by group. */
const order = (html: string) =>
  [...html.matchAll(/data-zerops-group="([^"]+)"/gu)].map((match) => match[1]);

/** A quiet group of its own id: one Mate who was spoken to, nothing waiting. */
function quiet(groupId: string) {
  return entry([item(`${groupId}-dev`, placed(groupId, groupId))]);
}

describe("a project's row", () => {
  it("says the one thing that needs the person as a sentence, with its title, and its verb at the end", () => {
    const row = section(render({ groups: [MERGING] }), 'data-zerops-group="aaa"');
    expect(row).toContain(MERGING.flow.nextStep.text);
    expect(row).toContain(pull().title);
    expect(row).toContain('data-test-verb="merge"');
    expect(row.match(/data-test-verb=/gu)).toHaveLength(1);
  });

  it("offers no verb on a row where nothing needs the person", () => {
    const row = section(render({ groups: [FRESH] }), 'data-zerops-group="bbb"');
    expect(row).toContain("Give Uma a first task");
    expect(row).not.toContain("data-test-verb=");
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
    expect(row).toContain('data-zerops-row-line="pending"');
    expect(row).not.toContain("waits for your merge");
    expect(row).not.toContain("data-test-verb=");
  });

  it("says a Mate stopped on an error before the reads answer: its own state decides it", () => {
    const stopped = entry([WREN], {}, false);
    const failed = {
      ...stopped,
      flow: {
        ...stopped.flow,
        nextStep: {
          kind: "fix-mate" as const,
          text: "Wren stopped on an error",
          verb: "Open",
          target: { kind: "mate" as const, projectId: "wren-dev" },
        },
      },
    };
    const row = section(render({ groups: [failed] }), 'data-zerops-group="aaa"');
    expect(row).toContain("Wren stopped on an error");
    expect(row).toContain('data-test-verb="fix-mate"');
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

  it("says what a working Mate is on", () => {
    const working = {
      ...quiet("ddd"),
      activities: [{ name: "Wren", working: true, subject: "Add a health check", at: undefined }],
    };
    const row = section(render({ groups: [working] }), 'data-zerops-group="ddd"');
    expect(row).toContain("Add a health check");
    expect(row).toContain(">Wren<");
  });
});

describe("a row's Mates", () => {
  it("names two in full and counts the rest; each listed one opens its conversation", () => {
    const opened: Array<string> = [];
    const KAI = item("kai-dev", placed("aaa", "sm-fixture"));
    const group = entry([WREN, UMA, KAI], { pullRequests: [pull()] });
    const tree = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[group]}
        openMate={(value) =>
          value.project.id === "uma-dev" ? undefined : () => opened.push(value.project.id)
        }
      />,
    );
    const mates = tree.root.findByProps({ "data-zerops-step": "mates" });
    const chips = mates.findAllByType("button");
    expect(chips.map((chip) => chip.props["aria-label"])).toEqual(["Open Wren"]);
    expect(mates.findAll((node) => node.children.includes("Uma"))).not.toHaveLength(0);
    expect(mates.findAll((node) => node.children.join("") === "+1")).not.toHaveLength(0);
    act(() => chips[0]!.props.onClick());
    expect(opened).toEqual(["wren-dev"]);
  });

  it("draws a Mate being created beside the listed one: waking, named, nothing to press", () => {
    const group = entry([WREN], { pullRequests: [pull()], pending: [VERA_COMING] });
    const row = section(
      render({ groups: [group], openMate: () => () => {} }),
      'data-zerops-group="aaa"',
    );
    const at = row.indexOf('data-zerops-surface="mate-coming"');
    const coming = row.slice(row.lastIndexOf("<span", at));
    expect(coming).toContain('data-mate-face-state="waking"');
    expect(coming).toContain(">Vera<");
    expect(row.match(/aria-label="Open /gu)).toHaveLength(1);
  });

  it("draws a brand-new project's row from its birth alone", () => {
    expect(order(render({ groups: born([WREN]) }))).toContain("ccc");
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

  it("shows beside the name where production runs one", () => {
    const row = section(render({ groups: [running] }), 'data-zerops-group="aaa"');
    expect(row).toContain('aria-label="Production runs v0.1.9"');
  });

  it("shows while the project's changes and releases are still being read", () => {
    const reading = { ...running, awaiting: true, changesAwaiting: true };
    const row = section(render({ groups: [reading] }), 'data-zerops-group="aaa"');
    expect(row).toContain('data-zerops-row-line="pending"');
    expect(row).toContain('aria-label="Production runs v0.1.9"');
  });

  it("is nowhere without production", () => {
    const row = section(render({ groups: [MERGING] }), 'data-zerops-group="aaa"');
    expect(row).not.toContain('data-zerops-step="production"');
  });
});

describe("a row's stops", () => {
  it("holds each one's read, opened or not: production's and every stage's", () => {
    const html = render({
      groups: [entry([WREN, STAGE, PROD], { stops: [STAGE_STOP, PRODUCTION_STOP] })],
    });
    const row = section(html, 'data-zerops-group="aaa"');
    expect(row).not.toContain('data-zerops-surface="group-detail"');
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

describe("the list's order", () => {
  it("raises the rows that need the person, keeping the given order within each part", () => {
    const needs = { ...MERGING, group: { ...MERGING.group, groupId: "m2" } };
    const html = render({ groups: [quiet("q1"), MERGING, quiet("q2"), needs] });
    expect(order(html)).toEqual(["aaa", "m2", "q1", "q2"]);
  });
});

describe("an opened row", () => {
  it("opens from its name into the Mates' cards, the pull requests and the environments", () => {
    const tree = mount(
      <ZeropsProjectsFlow<Item>
        {...FLOW_PROPS}
        groups={[
          entry([WREN, STAGE], {
            pullRequests: [pull(), pull({ number: 2 })],
            stops: [STAGE_STOP],
          }),
        ]}
      />,
    );
    expect(tree.root.findAllByProps({ "data-zerops-surface": "group-detail" })).toHaveLength(0);
    act(() => tree.root.findByProps({ "aria-expanded": false }).props.onClick());
    expect(tree.root.findAllByProps({ "data-test-mate": "wren-dev" })).toHaveLength(1);
    expect(tree.root.findAllByProps({ "data-test-environment": "fixture-stage" })).toHaveLength(1);
    // The step merges #2, the newest; #1 keeps its own Merge.
    const withMerge = (number: number) =>
      tree.root.findByProps({ "data-test-pull": number }).props["data-test-with-merge"];
    expect(withMerge(2)).toBe("false");
    expect(withMerge(1)).toBe("true");
  });

  // D7, one rule with the menu (`changeShowsReview`): while Wren works, its described changes
  // show no Review; at rest, they do.
  it.each([
    { case: "at work", working: true, review: "false" },
    { case: "at rest", working: false, review: "true" },
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
      act(() => tree.root.findByProps({ "aria-expanded": false }).props.onClick());
      const reviewOf = (number: number) =>
        tree.root.findByProps({ "data-test-pull": number }).props["data-test-review"];
      expect([reviewOf(1), reviewOf(2)]).toEqual([review, review]);
    },
  );

  it("opens by itself when the page names its project", () => {
    const html = render({ groups: [MERGING, FRESH], focusGroup: "bbb" });
    expect(section(html, 'data-zerops-group="bbb"')).toContain(
      'data-zerops-surface="group-detail"',
    );
    expect(section(html, 'data-zerops-group="aaa"')).not.toContain(
      'data-zerops-surface="group-detail"',
    );
  });

  it("still offers the release beside a broken production, not just the build (D28)", () => {
    const tree = mount(<ZeropsProjectsFlow<Item> {...FLOW_PROPS} groups={[brokenProduction()]} />);
    expect(tree.root.findAllByProps({ "data-test-verb": "fix-deploy" })).toHaveLength(1);
    act(() => tree.root.findByProps({ "aria-expanded": false }).props.onClick());
    expect(tree.root.findAllByProps({ "data-test-release-verb": "true" })).toHaveLength(1);
  });
});

describe("a row the page names (?group=)", () => {
  /** A document whose rows record each time they are scrolled into view. */
  function stubDocument() {
    const scrolled: Array<string> = [];
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("document", {
      getElementById: (id: string) => ({ scrollIntoView: () => scrolled.push(id) }),
    });
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    return { scrolled, interact: (type: string) => listeners.get(type)?.() };
  }
  const FOCUS = { ...FRESH, group: { ...FRESH.group, groupId: "fff" } };
  // A group no other test drew, so the list's memory of risen rows holds nothing of it.
  const regroup = (value: typeof FRESH) => ({
    ...value,
    group: { ...value.group, groupId: "ggg" },
  });
  const UNREAD = regroup(entry([WREN], { pullRequests: [pull()] }, false));
  const READ = regroup(entry([WREN], { pullRequests: [pull()] }));

  it("stays in view while rows above it rise as their reads answer", () => {
    const { scrolled } = stubDocument();
    const tree = mount(
      <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[FOCUS, UNREAD]} />,
    );
    expect(scrolled).toEqual(["project-fff"]);
    act(() =>
      tree.update(
        <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[FOCUS, READ]} />,
      ),
    );
    expect(scrolled).toEqual(["project-fff", "project-fff"]);
    vi.unstubAllGlobals();
  });

  it("lets the person's own scroll win", () => {
    const { scrolled, interact } = stubDocument();
    const tree = mount(
      <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[FOCUS, UNREAD]} />,
    );
    interact("wheel");
    act(() =>
      tree.update(
        <ZeropsProjectsFlow<Item> {...FLOW_PROPS} focusGroup="fff" groups={[FOCUS, READ]} />,
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
      const row = tree.root.findByProps({ "data-zerops-group": "app-0" });
      const toggle = row.findByProps({ "data-zerops-row-toggle": "true" });
      act(() => toggle.props.onClick());
      expect([...detailHolds]).toEqual([["app-0", 1]]);
      act(() => toggle.props.onClick());
      expect([...detailHolds]).toEqual([]);
      act(() => tree.unmount());
    },
  );
});
