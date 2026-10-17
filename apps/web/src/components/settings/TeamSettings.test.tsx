// @vitest-environment happy-dom
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { TeamList } from "./TeamSettings";
import { teamPeople, type TeamInput } from "./teamSettings.logic";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params = {},
    to,
    ...rest
  }: {
    readonly children?: ReactNode;
    readonly params?: Readonly<Record<string, string>>;
    readonly to: string;
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? "")} {...rest}>
      {children}
    </a>
  ),
}));

// A tooltip drawn in place, in a template of its own: what a pointer reads is in the markup.
vi.mock("../ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({
      render,
      children,
    }: {
      readonly render: unknown;
      readonly children?: ReactNode;
    }) =>
      isValidElement(render) ? (
        children === undefined ? (
          render
        ) : (
          cloneElement(render, undefined, children)
        )
      ) : (
        <>{children}</>
      ),
    TooltipPopup: ({ children }: { readonly children: ReactNode }) => (
      <template data-tooltip="">{children}</template>
    ),
  };
});

const member = (
  id: string,
  name: string,
  roleCode: string,
  extra: Partial<ZeropsOrganizationMember> = {},
): ZeropsOrganizationMember => ({
  id: `cu-${id}`,
  status: "ACTIVE",
  roleCode,
  user: { id, fullName: name, email: `${id}@example.com` },
  ...extra,
});

const TEAM = [
  member("ada", "Ada Owner", "OWNER"),
  member("al", "Al Admin", "ADMIN"),
  member("bob", "Bob Guest", "NO_ACCESS"),
  member("iva", "Iva Invited", "NO_ACCESS", { status: "WAITING_AUTHORIZATION" }),
  {
    id: "cu-token",
    status: "ACTIVE",
    roleCode: "BASIC_USER",
    user: { id: "t", email: "token-abc@zerops.io" },
  },
];

const input = (viewer?: TeamInput["viewer"], viewerUserId = "ada"): TeamInput => ({
  members: { known: true, status: "ready", refused: false, list: TEAM },
  grants: {
    "cu-bob": { status: "ready", value: [{ projectId: "snap-prod", roleCode: "READ_ONLY" }] },
  },
  places: { "snap-prod": { key: "g-snap", name: "Snap", groupId: "g-snap" } },
  pictures: {},
  viewerUserId,
  viewer,
});

/** The page as a person reads it: the count, each card's parts and where it leads, Invite. */
function drawn(
  viewer?: TeamInput["viewer"],
  viewerUserId?: string,
  list: TeamInput["members"]["list"] = TEAM,
  onSendAgain?: () => void,
) {
  const markup = renderToStaticMarkup(
    <TeamList
      {...(onSendAgain === undefined ? {} : { onSendAgain })}
      view={teamPeople({
        ...input(viewer, viewerUserId),
        members: { known: true, status: "ready", refused: false, list },
      })}
    />,
  );
  const body = new DOMParser().parseFromString(markup, "text/html").body;
  const part = (card: Element, name: string) =>
    card.querySelector(`[data-part="${name}"]`)?.textContent ?? null;
  return {
    heading: body.querySelector("h2")?.parentElement?.textContent,
    cards: [...body.querySelectorAll("ul[aria-label=People] > li > *")].map((card) => ({
      name: part(card, "name"),
      role: part(card, "role"),
      email: part(card, "email"),
      pending: card.hasAttribute("data-pending"),
      waiting: part(card, "pending"),
      href: card.querySelector("a")?.getAttribute("href") ?? null,
      // A press of its own, outside the link that opens their page.
      sendAgain:
        [...card.querySelectorAll("button")].find((button) => button.closest("a") === null)
          ?.textContent ?? null,
    })),
    invite: body.querySelector('[data-zerops-surface="invite-team"]') !== null,
    alone: body.querySelector('[data-part="alone"]')?.textContent ?? null,
  };
}

describe("the organization's team", () => {
  it("Everyone in the organization is a card, never a token: their name, role and e-mail", () => {
    const page = drawn();
    expect(page.heading).toBe("Team3 people · 1 invited");
    expect(page.cards.map(({ name, role, email }) => [name, role, email])).toEqual([
      ["Ada Owner", "Owner", "ada@example.com"],
      ["Al Admin", "Admin", "al@example.com"],
      ["Bob Guest", "Guest", "bob@example.com"],
      ["Iva Invited", "Guest", "iva@example.com"],
    ]);
  });

  it("An address too long for its card keeps its domain, the whole address on hover", () => {
    const address = "nova.storefront-operations@teashop-example.com";
    const markup = renderToStaticMarkup(
      <TeamList
        view={teamPeople({
          ...input(),
          members: {
            known: true,
            status: "ready",
            refused: false,
            list: [
              member("nova", address, "NO_ACCESS", {
                status: "WAITING_AUTHORIZATION",
                user: { id: "nova", email: address },
              }),
            ],
          },
        })}
      />,
    );
    const body = new DOMParser().parseFromString(markup, "text/html").body;
    const name = body.querySelector('[data-part="name"]');
    // The name before the @ and the domain stand apart, the domain whole; hover says it all.
    expect([...(name?.firstElementChild?.children ?? [])].map((part) => part.textContent)).toEqual([
      "nova.storefront-operations",
      "@teashop-example.com",
    ]);
    expect(name?.querySelector("template")?.innerHTML).toBe(address);
  });

  it("A card opens that person's own page", () => {
    expect(drawn().cards.map(({ href }) => href)).toEqual([
      "/settings/team/cu-ada",
      "/settings/team/cu-al",
      "/settings/team/cu-bob",
      "/settings/team/cu-iva",
    ]);
  });

  it("An invitation an owner may change offers Send again on its card, beside its page's link", () => {
    const owner = { roleCode: "OWNER", membershipId: "cu-ada" };
    expect(
      drawn(owner, "ada", TEAM, () => undefined).cards.map(({ sendAgain }) => sendAgain),
    ).toEqual([null, null, null, "Send again"]);
    // Nothing to send it with, nothing offered.
    expect(drawn(owner, "ada").cards.map(({ sendAgain }) => sendAgain)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("An invitation not joined yet is dimmed", () => {
    expect(drawn().cards.map(({ pending }) => pending)).toEqual([false, false, false, true]);
  });

  it("An invitation not joined yet says it waits for them to join", () => {
    expect(drawn().cards.map(({ waiting }) => waiting)).toEqual([
      null,
      null,
      null,
      "Invited · waiting for them to join",
    ]);
  });

  it.each([
    {
      sentence: "A team of one tells an owner who an invitation brings in",
      viewer: "OWNER",
      alone: "Only you so far. People you invite sign in with their own Zerops account.",
    },
    {
      sentence: "A team of one says nothing to someone who can't invite",
      viewer: "NO_ACCESS",
      alone: null,
    },
  ])("$sentence", ({ viewer, alone }) => {
    expect(drawn({ roleCode: viewer, membershipId: "cu-ada" }, "ada", [TEAM[0]!]).alone).toBe(
      alone,
    );
    expect(drawn({ roleCode: viewer, membershipId: "cu-ada" }, "ada").alone).toBeNull();
  });

  it.each([
    { sentence: "An owner finds Invite beside the search", viewer: "OWNER", invite: true },
    { sentence: "An admin finds Invite beside the search", viewer: "ADMIN", invite: true },
    { sentence: "A guest finds no Invite", viewer: "NO_ACCESS", invite: false },
    {
      sentence: "Nobody is invited or changed while the viewer's role is not known",
      viewer: undefined,
      invite: false,
    },
  ])("$sentence", ({ viewer, invite }) => {
    expect(
      drawn(viewer === undefined ? undefined : { roleCode: viewer, membershipId: "cu-x" }).invite,
    ).toBe(invite);
  });

  it("Back from inviting, the team says the invitation went out, marks the new row and puts focus on Invite", async () => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TeamList
          sent={["iva@example.com"]}
          view={teamPeople(input({ roleCode: "OWNER", membershipId: "cu-ada" }))}
        />,
      );
    });
    // Said to a screen reader only: the invite page said it where it was sent.
    expect(host.querySelector('[data-part="sent"]')).toBeNull();
    // The live region stands empty on the first paint, and is filled once focus has moved.
    expect(host.querySelector('[role="status"]')?.textContent).toBe("");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Invitation sent to iva@example.com",
    );
    expect(
      [...host.querySelectorAll("ul[aria-label=People] > li")].map((row) =>
        row.hasAttribute("data-arrived"),
      ),
    ).toEqual([false, false, false, true]);
    expect(document.activeElement?.getAttribute("data-zerops-surface")).toBe("invite-team");
    await act(async () => root.unmount());
    host.remove();
  });

  it("A visit with no invitation just sent says nothing of one and marks no row", () => {
    const markup = renderToStaticMarkup(
      <TeamList view={teamPeople(input({ roleCode: "OWNER", membershipId: "cu-ada" }))} />,
    );
    expect(markup).not.toContain("Invitation sent");
    expect(markup).not.toContain("data-arrived");
  });
});
