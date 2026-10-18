/**
 * *Add automated Mates* asks how many, proposes who they are, says what they do and what happens
 * next — and asks nobody's access: automated Mates belong to the organization.
 */
import type { MateTintId } from "@t3tools/shared/brand";
import { act, type ReactElement } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { AddAutomatedMatesForm, type AutomatedMatesChoice } from "./AddAutomatedMatesForm";

const TIER = { kind: "tier" as const, tier: "mate" as const, yaml: "services: []\n" };
const TINTS: Readonly<Record<string, MateTintId>> = { Otto: "violet", Ada: "sky", Milo: "coral" };
const PEOPLE = [{ clientUserId: "member-2", roleCode: "DEVELOPER" }];

type Props = Parameters<typeof AddAutomatedMatesForm>[0];

function form(props: Partial<Props> = {}): ReactElement {
  return (
    <Dialog open onOpenChange={() => {}}>
      <AddAutomatedMatesForm
        admin
        groupName="Tea Shop"
        keyState="set"
        limits={{ minutes: 60, costUsd: 3 }}
        onCancel={() => {}}
        onCreate={() => {}}
        people={{ kind: "ready", userRoles: PEOPLE }}
        propose={(taken) => ["Otto", "Ada", "Milo"].find((name) => !taken.includes(name))!}
        sources="GitHub issues labelled “mate” in acme/tea-shop"
        takenBotNames={{ names: ["Fen"], complete: true }}
        tier={TIER}
        tierLoading={false}
        tintFor={(name) => TINTS[name] ?? "slate"}
        {...props}
      />
    </Dialog>
  );
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  vi.unstubAllGlobals();
});

function mount(element: ReactElement): ReactTestRenderer {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Each name's die has a tooltip, which listens on `window` once mounted; there is no DOM here.
  const noDom = Object.fromEntries(
    ["Node", "Element", "HTMLElement", "ShadowRoot"].map((name) => [name, function none() {}]),
  );
  vi.stubGlobal("window", Object.assign(new EventTarget(), noDom));
  for (const [name, type] of Object.entries(noDom)) vi.stubGlobal(name, type);
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

const host = (tree: ReactTestRenderer, match: (node: ReactTestInstance) => boolean) =>
  tree.root.find((node) => typeof node.type === "string" && match(node));

function spoken(node: ReactTestInstance): string {
  if (node.props["aria-hidden"] === true) return "";
  return node.children.map((child) => (typeof child === "string" ? child : spoken(child))).join("");
}

function press(tree: ReactTestRenderer) {
  act(() => {
    host(tree, (node) => node.type === "form").props.onSubmit({ preventDefault: () => {} });
  });
}

function choose(tree: ReactTestRenderer, count: number) {
  const group = tree.root.find(
    (node) => node.props.onValueChange !== undefined && Array.isArray(node.props.value),
  );
  act(() => {
    group.props.onValueChange([String(count)]);
  });
}

const names = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => node.type === "input" && String(node.props["aria-label"]).startsWith("Name"))
    .map((node) => node.props.value as string);

const button = (tree: ReactTestRenderer, words: string) =>
  host(tree, (node) => node.type === "button" && spoken(node) === words);

describe("Add automated Mates", () => {
  it("asks how many, proposes a name and a face for each, and asks nobody's access", () => {
    const tree = mount(form());
    const said = spoken(tree.root);
    expect(said).toContain("Add automated Mates to Tea Shop");
    expect(said).not.toContain("Who can work with");
    expect(names(tree)).toEqual(["Otto"]);
    choose(tree, 3);
    expect(names(tree)).toEqual(["Otto", "Ada", "Milo"]);
    expect(spoken(tree.root)).toContain("Add 3 automated Mates");
  });

  it("says what they do: the project's sources, the organization's key, a task's limits", () => {
    const said = spoken(mount(form()).root);
    expect(said).toContain(
      "It takes tasks from GitHub issues labelled “mate” in acme/tea-shop. It runs on the organization's key (Nebius · GLM-5.3), at most $3 and 60 minutes per task.",
    );
    expect(said).toContain(
      "It comes up in about 2–4 minutes, sets up development in up to 15 more, then takes the first task waiting.",
    );
  });

  it("makes an automated Mate once chosen: nobody signs it in, its tasks come from GitHub", () => {
    const onCreate = vi.fn<(choice: AutomatedMatesChoice) => void>();
    const tree = mount(form({ onCreate }));
    choose(tree, 2);
    press(tree);
    expect(onCreate).toHaveBeenCalledWith({
      mates: [
        { name: "Otto", face: expect.objectContaining({ tint: "violet" }) },
        { name: "Ada", face: expect.objectContaining({ tint: "sky" }) },
      ],
      recipe: TIER,
      // Whoever reaches the project reaches its automated Mates: HQ shows a Mate by its grants.
      userRoles: PEOPLE,
    });
  });

  it("re-rolls one Mate's name, keeping the others", () => {
    const tree = mount(form());
    choose(tree, 2);
    const dice = tree.root.findAll(
      (node) => node.type === "button" && node.props["aria-label"] === "Another name",
    );
    act(() => {
      dice[0]!.props.onClick({
        nativeEvent: {},
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    });
    expect(names(tree)).toEqual(["Milo", "Ada"]);
  });

  it("refuses a name another Mate has, and makes none", () => {
    const onCreate = vi.fn();
    const tree = mount(form({ onCreate, firstName: "Fen" }));
    press(tree);
    expect(onCreate).not.toHaveBeenCalled();
    expect(spoken(tree.root)).toContain("Another Mate already has that name.");
  });

  it("waits for the project's people before making any, then goes", () => {
    const onCreate = vi.fn();
    const tree = mount(form({ onCreate, people: { kind: "reading" } }));
    press(tree);
    expect(onCreate).not.toHaveBeenCalled();
    expect(spoken(tree.root)).toContain("Reading who reaches this project…");
    act(() => tree.update(form({ onCreate })));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("says a project with no sources yet where one is added", () => {
    expect(spoken(mount(form({ sources: null })).root)).toContain(
      "No sources of tasks yet — add one on the project's page.",
    );
  });

  it("asks again with Automated chosen where the Add started over was automated", () => {
    const onCreate = vi.fn<(choice: AutomatedMatesChoice) => void>();
    const tree = mount(form({ firstName: "Juno", onCreate }));
    expect(names(tree)).toEqual(["Juno"]);
    press(tree);
    expect(onCreate.mock.calls[0]?.[0].mates.map((mate) => mate.name)).toEqual(["Juno"]);
  });
});

describe("Add automated Mates: the organization's key", () => {
  const NO_KEY = "which isn't set yet";

  it.each([
    ["the organization has no key: it says so, and where it is set", "missing", true],
    ["the organization has its key: nothing more", "set", false],
    ["not known yet: nothing more", "unknown", false],
  ] as const)("%s", (_case, key, says) => {
    const onOpenKeySettings = vi.fn();
    const tree = mount(form({ keyState: key, onOpenKeySettings }));
    expect(spoken(tree.root).includes(NO_KEY)).toBe(says);
    if (!says) return;
    act(() => {
      button(tree, "Set it in Settings › Automation").props.onClick();
    });
    expect(onOpenKeySettings).toHaveBeenCalledOnce();
  });

  it("tells one who can't set the key who sets it, and sends them nowhere", () => {
    const tree = mount(form({ keyState: "missing", admin: false, onOpenKeySettings: vi.fn() }));
    expect(spoken(tree.root)).toContain(
      `${NO_KEY}, at most $3 and 60 minutes per task. An Owner or Admin of your organization sets it.`,
    );
    expect(() => button(tree, "Set it in Settings › Automation")).toThrow();
  });

  // The owner's cardinal sin: the key's note must land in room the first frame already held.
  it("holds the key note's room from the first frame when the key is not read yet", () => {
    const held = (tree: ReactTestRenderer) =>
      tree.root.findAll((node) => node.props["data-zerops-automated-key-note"] === "held");
    const tree = mount(form({ keyState: "unknown" }));
    expect(held(tree)).toHaveLength(1);
    act(() => tree.update(form({ keyState: "missing" })));
    expect(held(tree)).toHaveLength(1);
    expect(spoken(tree.root)).toContain(NO_KEY);
  });

  it("draws no key note where the key was read before the dialog opened", () => {
    const tree = mount(form({ keyState: "set" }));
    expect(
      tree.root.findAll((node) => node.props["data-zerops-automated-key-note"] !== undefined),
    ).toHaveLength(0);
  });

  it("keeps a choice it already offered, unavailable, once HQ turns out unable to make one", () => {
    const onCreate = vi.fn();
    const tree = mount(form({ keyState: "unknown", onCreate }));
    act(() => tree.update(form({ keyState: "unsupported", onCreate })));
    expect(spoken(tree.root)).toContain("Update HQ to make automated Mates.");
    expect(button(tree, "Add 1 automated Mate").props.disabled).toBe(true);
    press(tree);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
