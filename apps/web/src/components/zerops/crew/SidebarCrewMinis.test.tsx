import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { CrewDigest, MateThreadKind, OverviewLogins } from "@t3tools/shared/mateLink";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { MateCrewRead } from "../../../zerops/crew/useCrew";
import { SidebarCrewMinis, useCrewRows, type CrewRowMate } from "./SidebarCrewMinis";
import type { SidebarCrewRead } from "./SidebarCrewMinis.logic";

/** What HQ holds of each Mate's crew, by project, as a test sets it. */
const hq = vi.hoisted(() => ({ reads: new Map<string, unknown>() }));
vi.mock("../../../zerops/crew/useCrew", async () => {
  const { Atom } = await import("effect/reactivity");
  return { mateCrewAtom: Atom.family((projectId: string) => Atom.make(hq.reads.get(projectId))) };
});
// Who is looking: Ada.
vi.mock("../../../zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({ user: { id: "ada" } }),
}));

const ENVIRONMENT = EnvironmentId.make("env-minis");
const NAMES = ["Ada", "Bo", "Cy", "Dee", "Eve", "Fay", "Gus"] as const;
const TINTS = ["violet", "sky", "coral", "rose", "olive", "amber", "sand"] as const;
const LOGINS: OverviewLogins = {
  "claude-code": { signedInBy: "ada", present: true, token: false },
};

/** A crew of `size`, Ada leading, each crewmate's chat in the kind `kinds` gives, idle else. */
function digest(
  input: {
    readonly size?: number;
    readonly kinds?: Readonly<Record<string, MateThreadKind>>;
    readonly ready?: ReadonlyArray<string>;
  } = {},
): CrewDigest {
  return {
    crewmates: NAMES.slice(0, input.size ?? 4).map((name, index) => ({
      handle: name.toLowerCase(),
      displayName: name,
      tint: TINTS[index]!,
      lead: index === 0,
      threadId: ThreadId.make(`thread-${name.toLowerCase()}`),
      threadKind: input.kinds?.[name] ?? "idle",
      loginKey: "claude-code",
    })),
    attention: [],
    readyTasks: (input.ready ?? []).map((name) => ({
      id: `task-${name.toLowerCase()}`,
      owner: name.toLowerCase(),
    })),
    personLands: true,
  };
}

/** The crew handed in, as a harness does. */
const handed = (crew: CrewDigest | null, logins: OverviewLogins = LOGINS): SidebarCrewRead => ({
  status: crew === null ? "none" : "applied",
  crew,
  logins,
  environmentId: ENVIRONMENT,
});

/** A Mate's row as the menu lays it: its name, then its crew's minis on the same line. */
function MateRow({ mate }: { readonly mate: CrewRowMate }) {
  const facts = useCrewRows([mate]).get(mate.projectId);
  return (
    <button data-zerops-surface="sidebar-mate" type="button">
      <span className="menu-name">Vira</span>
      {facts === undefined ? null : <SidebarCrewMinis facts={facts} />}
    </button>
  );
}

const drawn = (mate: CrewRowMate) => renderToStaticMarkup(<MateRow mate={mate} />);
const faces = (markup: string) => markup.match(/data-crew-mini="([^"]+)"/gu) ?? [];
const states = (markup: string) =>
  [...markup.matchAll(/data-mate-face-state="([^"]+)"/gu)].map((match) => match[1]);

describe("SidebarCrewMinis", () => {
  it("draws the crew of a Mate it holds no socket to, from HQ's overview", () => {
    const read: MateCrewRead = {
      status: "applied",
      crew: { status: "applied", ...digest({ kinds: { Bo: "working" } }) },
      logins: LOGINS,
      current: true,
      environmentId: ENVIRONMENT,
    };
    hq.reads.set("crm-dev", read);
    const markup = drawn({ projectId: "crm-dev", mine: true });
    expect(faces(markup)).toEqual([
      'data-crew-mini="ada"',
      'data-crew-mini="bo"',
      'data-crew-mini="cy"',
      'data-crew-mini="dee"',
    ]);
    expect(states(markup)).toEqual(["idle", "working", "idle", "idle"]);
  });

  it("draws a crew's crewmates after its Mate's name, never a line under it", () => {
    const markup = drawn({ projectId: "shop", mine: true, read: handed(digest()) });
    // The name, then the minis, inside the row's own button: no line of their own.
    expect(markup).toMatch(
      /<button[^>]*><span class="menu-name">Vira<\/span><span class="menu-minis" data-zerops-surface="sidebar-crew-minis"/u,
    );
    expect(markup).not.toContain('data-zerops-surface="sidebar-crew"');
    // They open nothing and take no focus: the row opens its Mate.
    expect(markup.match(/<button/gu)).toHaveLength(1);
    // The row's name carries the crew in words.
    expect(markup).toContain("Crew: Ada, Bo, Cy, Dee");
  });

  it("draws a crew handed in instead of reading HQ's", () => {
    hq.reads.set("todo", undefined);
    const markup = drawn({
      projectId: "todo",
      mine: true,
      read: handed(digest({ kinds: { Cy: "input" } })),
    });
    expect(faces(markup)[0]).toBe('data-crew-mini="cy"');
    expect(states(markup)[0]).toBe("needs");
  });

  it("folds a crew of seven into four faces and +3", () => {
    const markup = drawn({ projectId: "big", mine: true, read: handed(digest({ size: 7 })) });
    expect(faces(markup)).toHaveLength(4);
    expect(markup).toContain(">+3</span>");
    expect(markup).toContain("Crew: Ada, Bo, Cy, Dee, Eve, Fay, Gus");
  });

  it("draws nothing without an applied crew", () => {
    hq.reads.set("bare", { status: null, crew: null, logins: {}, current: true });
    expect(drawn({ projectId: "bare", mine: true })).not.toContain("sidebar-crew-minis");
    expect(drawn({ projectId: "none", mine: true, read: handed(null) })).not.toContain(
      "sidebar-crew-minis",
    );
  });

  it("offers no Review where the task's crewmate is not the viewer's to run (D6)", () => {
    const read = handed(digest({ ready: ["Cy"] }), {
      "claude-code": { signedInBy: "bo", present: true, token: false },
    });
    const reviews: unknown[] = [];
    function Probe() {
      reviews.push(useCrewRows([{ projectId: "d6", mine: true, read }]).get("d6")?.reviews);
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(reviews).toEqual([[]]);
  });

  it("keeps a Mate's crew facts the same while nothing changes, whatever else the menu lists", () => {
    const read = handed(digest({ kinds: { Bo: "working" } }));
    const seen: unknown[] = [];
    function Probe({ others }: { readonly others: number }) {
      const mates: CrewRowMate[] = [
        { projectId: "kept", mine: true, read },
        ...Array.from({ length: others }, (_, index) => ({
          projectId: `other-${String(index)}`,
          mine: false,
          read: handed(digest({ size: 2 })),
        })),
      ];
      seen.push(useCrewRows(mates).get("kept"));
      return null;
    }
    renderToStaticMarkup(<Probe others={0} />);
    renderToStaticMarkup(<Probe others={3} />);
    expect(seen[1]).toBe(seen[0]);
  });

  // HQ not answering now, or the Mate asleep: the faces keep their places, at rest.
  it.each([
    { case: "HQ's answer is not current", read: { current: false } },
    { case: "its Mate sleeps", read: { current: false, environmentId: undefined } },
  ])("draws the crew at rest where what it does is not known now: $case", ({ read }) => {
    const projectId = `rest-${read.environmentId === undefined ? "asleep" : "stale"}`;
    hq.reads.set(projectId, {
      status: "applied",
      crew: { status: "applied", ...digest({ kinds: { Bo: "working", Cy: "input" } }) },
      logins: LOGINS,
      environmentId: ENVIRONMENT,
      ...read,
    });
    const markup = drawn({ projectId, mine: true });
    expect(states(markup)).toEqual(["idle", "idle", "idle", "idle"]);
  });

  describe("while watched", () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Mounted for watching with no DOM, motion welcome unless `reduced`. */
    function watch(reduced = false) {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const noDom = Object.fromEntries(
        ["Node", "Element", "HTMLElement", "ShadowRoot"].map((name) => [name, function none() {}]),
      );
      vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), noDom, {
          matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
        }),
      );
      for (const [name, type] of Object.entries(noDom)) vi.stubGlobal(name, type);
    }
    const mate = (kinds: Readonly<Record<string, MateThreadKind>>): CrewRowMate => ({
      projectId: "watched",
      mine: true,
      read: handed(digest({ kinds })),
    });
    const mount = (first: CrewRowMate) => {
      let tree: ReactTestRenderer | undefined;
      act(() => {
        tree = create(<MateRow mate={first} />);
      });
      if (tree === undefined) throw new Error("not drawn");
      return tree;
    };
    const greeting = (tree: ReactTestRenderer, id: string): string | undefined => {
      const box = tree.root.find((node) => node.props["data-crew-mini"] === id);
      const body = box.find((node: ReactTestInstance) => node.props.className === "menu-mini-body");
      return body.props["data-crew-mini-greet"];
    };

    it("cheers once for a crewmate that finishes while watched", () => {
      watch();
      const tree = mount(mate({ Bo: "working" }));
      expect(greeting(tree, "bo")).toBeUndefined();
      act(() => tree.update(<MateRow mate={mate({})} />));
      expect(greeting(tree, "bo")).toBe("cheer");
      // Happy while it cheers.
      expect(
        tree.root
          .find((node) => node.props["data-crew-mini"] === "bo")
          .findByProps({
            "data-zerops-primitive": "mate-face",
          }).props["data-mate-face-state"],
      ).toBe("done");
      const body = tree.root
        .find((node) => node.props["data-crew-mini"] === "bo")
        .find((node: ReactTestInstance) => node.props.className === "menu-mini-body");
      act(() =>
        body.props.onAnimationEnd({
          animationName: "menu-mini-cheer",
          target: body,
          currentTarget: body,
        }),
      );
      expect(greeting(tree, "bo")).toBeUndefined();
      act(() => tree.update(<MateRow mate={mate({})} />));
      expect(greeting(tree, "bo")).toBeUndefined();
      act(() => tree.unmount());
    });

    it("does not cheer for a crewmate already done on a reload", () => {
      watch();
      const tree = mount(mate({}));
      act(() => tree.update(<MateRow mate={mate({})} />));
      expect(greeting(tree, "bo")).toBeUndefined();
      act(() => tree.unmount());
    });

    it("turns a crewmate that comes to need the viewer out to face them, and it waits", () => {
      watch();
      const tree = mount(mate({ Cy: "working" }));
      act(() => tree.update(<MateRow mate={mate({ Cy: "input" })} />));
      expect(greeting(tree, "cy")).toBe("turn");
      expect(
        tree.root.find((node) => node.props["data-crew-mini"] === "cy").props[
          "data-crew-mini-state"
        ],
      ).toBe("needs");
      act(() => tree.unmount());
    });

    it("holds every crewmate still with reduced motion", () => {
      watch(true);
      const tree = mount(mate({ Bo: "working", Cy: "working" }));
      act(() => tree.update(<MateRow mate={mate({ Cy: "input" })} />));
      expect(greeting(tree, "bo")).toBeUndefined();
      expect(greeting(tree, "cy")).toBeUndefined();
      act(() => tree.unmount());
    });
  });
});
