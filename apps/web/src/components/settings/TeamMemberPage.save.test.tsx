// @vitest-environment happy-dom
/**
 * A person's page through a save: what was saved stays on screen until their grants are read
 * again, then the read-back stands — never an empty list in between.
 */
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TeamMemberView, type TeamMemberActions } from "./TeamMemberPage";
import type { AccessDraft, ProjectChip } from "./teamMember.logic";
import { teamPeople, type TeamPerson } from "./teamSettings.logic";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { readonly children?: ReactNode }) => <a>{children}</a>,
}));

// The chips and picker are the shared component's; here the chips are words and the picker's
// choices arrive as they would.
vi.mock("./MemberProjectAccess", () => ({
  MemberProjectAccess: (props: {
    readonly chips: ReadonlyArray<ProjectChip>;
    readonly onAdd: (picks: Readonly<Record<string, string>>) => void;
  }) => (
    <ul data-add={props.onAdd} data-zerops-surface="their-projects">
      {props.chips.map((chip) => (
        <li key={chip.projectId}>{`${chip.label} ${chip.level}`}</li>
      ))}
    </ul>
  ),
}));

vi.mock("../ui/alert-dialog", () => {
  const nothing = () => null;
  return {
    AlertDialog: nothing,
    AlertDialogClose: nothing,
    AlertDialogDescription: nothing,
    AlertDialogFooter: nothing,
    AlertDialogHeader: nothing,
    AlertDialogPopup: nothing,
    AlertDialogTitle: nothing,
  };
});

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

const RITA: ZeropsOrganizationMember = {
  id: "cu-rita",
  status: "ACTIVE",
  roleCode: "READ_ONLY",
  user: { id: "rita", fullName: "Rita Cerna", email: "rita.cerna@example.com" },
};

const person = (() => {
  const view = teamPeople({
    members: { known: true, status: "ready", refused: false, list: [RITA] },
    grants: {},
    places: {},
    pictures: {},
    viewerUserId: "owner",
    viewer: { roleCode: "OWNER", membershipId: "cu-owner" },
  });
  return (view.kind === "people" ? view.people[0] : undefined) as TeamPerson;
})();

const PROJECTS = [{ projectId: "xyz-stage", label: "xyz · stage" }];

describe("a person's project access through a save", () => {
  it("keeps the person's saved project access on screen after Save, never an empty list", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const saveAccess = vi.fn(async () => {});
    const actions: TeamMemberActions = {
      updateMembership: async () => {},
      saveAccess,
      remove: async () => {},
    };
    const page = (grants: AccessDraft | null) => (
      <TeamMemberView
        actions={actions}
        grants={grants}
        organizationName="Acme"
        person={person}
        projects={PROJECTS}
        viewerRole="OWNER"
      />
    );
    const before: AccessDraft = {};
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(page(before));
    });
    mounted.push(tree);
    const chips = () =>
      tree.root
        .findByProps({ "data-zerops-surface": "their-projects" })
        .findAllByType("li")
        .map((chip) => chip.children.join(""));
    act(() => {
      (
        tree.root.findByProps({ "data-zerops-surface": "their-projects" }).props["data-add"] as (
          picks: Readonly<Record<string, string>>,
        ) => void
      )({ "xyz-stage": "none" });
    });
    await act(async () => {
      const text = (node: ReactTestInstance): string =>
        node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
      tree.root
        .findAll((node) => node.type === "button" && text(node) === "Save project access")[0]!
        .props.onClick();
    });
    expect(saveAccess).toHaveBeenCalledWith([{ projectId: "xyz-stage", roleCode: "NO_ACCESS" }]);
    // Saved, their grants not read again yet: the saved list stands.
    expect(chips()).toEqual(["xyz · stage hidden"]);
    // Read again while the page waits: still the saved list, never the read it started from.
    act(() => tree.update(page(null)));
    expect(chips()).toEqual(["xyz · stage hidden"]);
    // The read-back stands once it arrives.
    act(() => tree.update(page({ "xyz-stage": "NO_ACCESS" })));
    expect(chips()).toEqual(["xyz · stage hidden"]);
    act(() => tree.update(page({})));
    expect(chips()).toEqual([]);
  });
});
