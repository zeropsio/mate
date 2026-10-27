// @vitest-environment happy-dom
import { act, createElement as h, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "~/zerops/accountLifetime";
import { beginCreation, useCreations } from "~/zerops/creations";
import { useNewMateDialog } from "~/zerops/newMate";
import type { NewProjectBirth } from "~/zerops/newProjectBirth";

import { comingEndsEntries, SidebarComingEnds } from "./SidebarComingEnds";

/** Ida, added to Acme CRM from this tab, before Zerops took its project. */
const IDA: NewProjectBirth = {
  birthId: "add-1",
  organizationId: "org-acme",
  appId: "g-acme",
  intent: null,
  hq: { projectId: "hq", address: "https://hq.example" },
  name: "Acme CRM",
  botName: "Ida",
  face: { tint: "rose", shape: "seal" },
  locationId: null,
  agents: [],
  adds: { appId: "g-acme", registers: true },
  startedAt: 0,
  step: "create",
  failed: null,
  projectId: null,
};

/** How each creation the row stands for reads, as its operations would say. */
const shown = new Map<string, NewProjectBirth>();
vi.mock("~/zerops/creations", async (actual) => ({
  ...(await actual<typeof import("~/zerops/creations")>()),
  useCreation: (birthId: string) => shown.get(birthId),
}));

/** The creations this tab holds, read through the real hook. */
let held: ReadonlyArray<string> = [];
function Held() {
  const creations = useCreations();
  useEffect(() => {
    held = creations.map((creation) => creation.birthId);
  }, [creations]);
  return null;
}

/** Ida's Add, held from the press. */
const pressIda = () => {
  const { birthId, organizationId, name, botName, face, locationId, agents, adds } = IDA;
  beginCreation({
    ask: { birthId, organizationId, name, botName, face, locationId, agents, adds },
    hq: IDA.hq,
    now: 0,
    run: () => undefined,
  });
  act(() => {
    tree = create(h(Held));
  });
};
const REFUSED = { ...IDA, failed: { reason: "No room.", uncertain: false } };
const LOST = { ...IDA, failed: { reason: "Lost.", uncertain: true } };

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openAccountLifetime("u-ada");
  useNewMateDialog.setState({ asked: null });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  closeAccountLifetime();
  shown.clear();
  useNewMateDialog.setState({ asked: null });
  vi.unstubAllGlobals();
});

const render = (made: NewProjectBirth) => {
  shown.set(made.birthId, made);
  act(() => {
    tree = create(
      h(SidebarComingEnds, {
        birthId: made.birthId,
        name: "Ida",
        children: h("button", { "data-row": "" }),
      }),
    );
  });
  return tree!;
};
const trigger = (rendered: ReactTestRenderer) =>
  rendered.root.findAll(
    (node) => node.type === "button" && node.props["aria-label"] === "More for Ida",
  );

// Run 6's reviews: a stopped Add stood in the menu all session, its one way on Try again — and one
// Zerops may have made stood beside the listed Mate with only the way to the projects.
describe("a coming Mate's ⋯ in the menu", () => {
  it.each([
    { case: "running: no ⋯", made: IDA, menu: false },
    { case: "refused for certain: a ⋯", made: REFUSED, menu: true },
    { case: "one Zerops may have made: a ⋯", made: LOST, menu: true },
  ])("$case", ({ made, menu }) => {
    const rendered = render(made);
    expect(trigger(rendered)).toHaveLength(menu ? 1 : 0);
    // The row itself stands either way.
    expect(rendered.root.findAll((node) => node.props["data-row"] !== undefined)).toHaveLength(1);
  });

  it.each([
    { case: "refused for certain", made: REFUSED, labels: ["Start over", "Dismiss"] },
    { case: "one Zerops may have made", made: LOST, labels: ["Dismiss"] },
  ])("offers $labels where $case", ({ made, labels }) => {
    expect(comingEndsEntries(made).map((entry) => entry.label)).toEqual(labels);
  });

  it("Start over takes the row out and opens Add over its project, its name there to change", () => {
    pressIda();
    act(() => comingEndsEntries(REFUSED)[0]!.onSelect());
    expect(held).toEqual([]);
    expect(useNewMateDialog.getState().asked).toMatchObject({
      groupId: "g-acme",
      again: { botName: "Ida" },
    });
  });

  it("Dismiss takes the row out and asks for nothing", () => {
    pressIda();
    expect(held).toEqual(["add-1"]);
    act(() => comingEndsEntries(LOST)[0]!.onSelect());
    expect(held).toEqual([]);
    expect(useNewMateDialog.getState().asked).toBeNull();
  });
});
