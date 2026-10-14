/**
 * Inviting someone from Settings → Team: the address checked with Zerops, a name asked only where
 * the address has no Zerops account, then a role — and for a developer or a guest, the projects
 * they're given — each answer awaited in the dialog, a refusal said there.
 */
import type { TeamRole } from "@t3tools/client-runtime/zerops/teamRoles";
import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TeamInviteForm, type TeamInviteActions } from "./TeamInviteDialog";

vi.mock("../ui/dialog", () => {
  const passThrough = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    DialogHeader: passThrough,
    DialogTitle: passThrough,
    DialogDescription: passThrough,
    DialogPanel: passThrough,
    DialogFooter: passThrough,
  };
});

vi.mock("../ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock("../ui/radio-group", () => ({
  RadioGroup: (props: {
    readonly children?: ReactNode;
    readonly "aria-label": string;
    readonly onValueChange: (value: string) => void;
  }) => (
    <div aria-label={props["aria-label"]} data-choose={props.onValueChange} role="radiogroup">
      {props.children}
    </div>
  ),
  Radio: (props: { readonly value: string }) => <span data-value={props.value} />,
}));

vi.mock("../ui/checkbox", () => ({
  Checkbox: (props: { readonly onCheckedChange: (checked: boolean) => void }) => (
    <span data-check={props.onCheckedChange} role="checkbox" />
  ),
}));

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

const PROJECTS = [
  { groupId: "g-beviro", name: "Beviro" },
  { groupId: "g-snap", name: "Snap" },
];

function mount(
  roles: ReadonlyArray<TeamRole> = ["admin", "developer", "guest", "owner"],
  actions: Partial<TeamInviteActions> = {},
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const check = vi.fn(actions.check ?? (async () => ({ kind: "new" as const })));
  const send = vi.fn(actions.send ?? (async () => {}));
  const onDone = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <TeamInviteForm
        actions={{ check, send, shownHere: (id) => id === "cu-here" }}
        onCancel={() => {}}
        onDone={onDone}
        organizationName="Acme"
        projects={PROJECTS}
        roles={roles}
      />,
    );
  });
  mounted.push(tree);
  const root = tree.root;
  const text = (node: ReactTestInstance): string =>
    node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
  const field = (id: string) =>
    root.find((node) => node.type === "input" && String(node.props.id).endsWith(id));
  const group = (label: string) =>
    root.find((node) => node.props.role === "radiogroup" && node.props["aria-label"] === label);
  return {
    check,
    send,
    onDone,
    type: (id: string, value: string) => act(() => field(id).props.onChange({ target: { value } })),
    submit: () =>
      act(async () => {
        root.findByType("form").props.onSubmit({ preventDefault: () => {} });
      }),
    roles: () =>
      group("Their role")
        .findAll((node) => node.props["data-value"] !== undefined)
        .map((node) => node.props["data-value"] as string),
    choose: (label: string, value: string) =>
      act(() => (group(label).props["data-choose"] as (value: string) => void)(value)),
    projects: () =>
      root
        .findAll(
          (node) =>
            node.type === "label" &&
            node.findAll((one) => one.props.role === "checkbox").length > 0,
        )
        .map(text),
    tick: (name: string) =>
      act(() => {
        const label = root.find((node) => node.type === "label" && text(node) === name);
        (
          label.find((node) => node.props.role === "checkbox").props["data-check"] as (
            checked: boolean,
          ) => void
        )(true);
      }),
    pressLabel: () => text(root.findAllByType("button").at(-1)!),
    alerts: () =>
      root
        .findAll((node) => node.type === "p" && node.props.role === "alert")
        .map(text)
        .filter((line) => line !== ""),
  };
}

describe("inviting someone to the team", () => {
  it("A new address is asked for a name, then a role and projects, then sent", async () => {
    const form = mount();
    form.type("-email", "eva@example.com");
    await form.submit();
    form.type("-first", "Eva");
    form.type("-last", "Dvořáková");
    await form.submit();
    expect(form.roles()).toEqual(["admin", "developer", "guest", "owner"]);
    form.choose("Their role", "guest");
    form.tick("Snap");
    form.choose("What they may do on those projects", "look");
    expect(form.pressLabel()).toBe("Send invite");
    await form.submit();
    expect(form.send).toHaveBeenCalledWith(
      "eva@example.com",
      { kind: "new", firstName: "Eva", lastName: "Dvořáková" },
      { role: "guest", groups: ["g-snap"], level: "look" },
    );
    expect(form.onDone).toHaveBeenCalled();
  });

  it("A developer or a guest is offered the organization's projects; an admin isn't", async () => {
    const form = mount(undefined, {
      check: async () => ({ kind: "existing", userId: "u-eva" }),
    });
    form.type("-email", "eva@example.com");
    await form.submit();
    expect(form.projects()).toEqual(["Beviro", "Snap"]);
    form.choose("Their role", "admin");
    expect(form.projects()).toEqual([]);
    await form.submit();
    expect(form.send).toHaveBeenCalledWith(
      "eva@example.com",
      { kind: "existing", userId: "u-eva" },
      { role: "admin", groups: [], level: "work" },
    );
  });

  it("An admin is offered only the roles an admin may give", async () => {
    const form = mount(["developer", "guest"], {
      check: async () => ({ kind: "existing", userId: "u-eva" }),
    });
    form.type("-email", "eva@example.com");
    await form.submit();
    expect(form.roles()).toEqual(["developer", "guest"]);
  });

  it("Someone on the team already is changed in the list, not invited", async () => {
    const form = mount(undefined, {
      check: async () => ({ kind: "member", clientUserId: "cu-here", roleCode: "NO_ACCESS" }),
    });
    form.type("-email", "eva@example.com");
    await form.submit();
    expect(form.alerts()).toEqual([
      "Already in this organization — change their access in the list.",
    ]);
    expect(form.send).not.toHaveBeenCalled();
  });

  it("Zerops's refusal is said in the dialog, which stays open", async () => {
    const form = mount(undefined, {
      check: async () => ({ kind: "existing", userId: "u-eva" }),
      send: async () => {
        throw new Error("Only an organization owner or admin can invite.");
      },
    });
    form.type("-email", "eva@example.com");
    await form.submit();
    await form.submit();
    expect(form.alerts()).toEqual(["Only an organization owner or admin can invite."]);
    expect(form.onDone).not.toHaveBeenCalled();
  });
});
