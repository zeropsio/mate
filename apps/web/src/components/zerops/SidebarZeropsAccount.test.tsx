import { markupDom } from "../../../test/markupDom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

import { setLocalStorageItem } from "~/hooks/useLocalStorage";
import { MATE_SCOPE_STORAGE_KEY, MateScopeSchema } from "~/zerops/mateScope";
import { PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema } from "~/zerops/projectOrderPreference";

import { Menu } from "../ui/menu";
import { SidebarZeropsAccount, SidebarZeropsAccountMenu } from "./SidebarZeropsAccount";
import { zeropsAccountDisplay } from "./landing/ZeropsAccountControl.logic";

const ADA = zeropsAccountDisplay({
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  firstName: "Ada",
  avatar: { smallAvatarUrl: "https://cdn/ada.png" },
});

const organization = (name: string, id = name): ZeropsOrganization => ({
  id,
  name,
  membershipId: `m-${id}`,
});

const ZEROPS = organization("Zerops");
const ACME = organization("Acme");

const render = (props: Partial<Parameters<typeof SidebarZeropsAccount>[0]> = {}) =>
  renderToStaticMarkup(
    <SidebarZeropsAccount
      account={ADA}
      activeOrganization={ZEROPS}
      destination={null}
      destinationIcon={() => null}
      onGo={() => {}}
      onSelectOrganization={() => {}}
      onSignOut={() => {}}
      organizations={[ZEROPS]}
      {...props}
    />,
  );

describe("SidebarZeropsAccount", () => {
  it("says who is signed in and whose projects are listed above", () => {
    const html = render();
    expect(html).toContain('data-zerops-surface="sidebar-account"');
    expect(html).toContain('src="https://cdn/ada.png"');
    expect(html).toContain(">Ada<");
    expect(html).toContain(">Zerops<");
    expect(html).toContain('aria-label="Account: Ada"');
  });

  it("leaves the organization line out until one is known, rather than promising a name", () => {
    const html = render({ activeOrganization: null });
    expect(html).toContain(">Ada<");
    expect(html).not.toContain('data-zerops-surface="sidebar-account-organization"');
  });

  it("falls back to initials when the account has no picture", () => {
    const html = render({ account: zeropsAccountDisplay({ email: "ops@example.com" }) });
    expect(html).toContain('data-zerops-avatar="initials"');
    expect(html).toContain(">O<");
  });

  it("collapses to the picture alone, with no name to wrap on a rail", () => {
    const html = render({ collapsed: true });
    expect(html).toContain('data-zerops-avatar="picture"');
    expect(html).not.toContain(">Zerops<");
    // The name is still the control's accessible one — a rail is not silence.
    expect(html).toContain('aria-label="Account: Ada"');
  });
});

describe("SidebarZeropsAccountMenu", () => {
  const renderMenu = (props: Partial<Parameters<typeof SidebarZeropsAccountMenu>[0]> = {}) =>
    renderToStaticMarkup(
      <Menu>
        <SidebarZeropsAccountMenu
          account={ADA}
          activeOrganization={ZEROPS}
          destination={null}
          destinationIcon={() => null}
          onGo={() => {}}
          onSelectOrganization={() => {}}
          onSignOut={() => {}}
          organizations={[ZEROPS]}
          {...props}
        />
      </Menu>,
    );

  // As the approved prototype drew it: the person, and what they are in the
  // organization the list shows; the address only while none is known.
  it("names the account in full, and what it is in the organization the list shows", () => {
    const html = renderMenu({ activeOrganization: { ...ZEROPS, roleCode: "OWNER" } });
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Owner of Zerops");
    expect(html).not.toContain("ada@example.com");
    expect(renderMenu({ activeOrganization: null })).toContain("ada@example.com");
  });

  it("offers the Show and Order choices and marks Everyone selected", () => {
    const html = renderMenu();
    expect(html.match(/data-zerops-account-scope="/g)).toHaveLength(2);
    expect(html.match(/data-zerops-account-order="/g)).toHaveLength(3);
    const document = markupDom(html);
    expect(
      Array.from(document.querySelectorAll('[role="menuitemradio"]'))
        .find((button) => button.textContent === "Everyone")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("folds every place the foot used to spend a glyph on", () => {
    const html = renderMenu();
    for (const id of ["projects", "git", "usage", "settings"]) {
      expect(html).toContain(`data-zerops-account-destination="${id}"`);
    }
    expect(html).toContain("Sign out");
  });

  it("names the page that is already open rather than lighting nothing", () => {
    expect(renderMenu({ destination: "usage" })).toContain(">Open<");
    expect(renderMenu({ destination: null })).not.toContain(">Open<");
  });

  it("names the one organization an account is in, because the trigger promises it", () => {
    const html = renderMenu({ organizations: [ZEROPS] });
    expect(html).toContain("Organization");
    expect(html).toContain('aria-checked="true"');
  });

  it("offers nothing while the memberships have not been read", () => {
    expect(renderMenu({ organizations: [] })).not.toContain("Organization");
  });

  it("offers every organization once there is a choice to make", () => {
    const html = renderMenu({ organizations: [ZEROPS, ACME] });
    expect(html).toContain("Organization");
    expect(html).toContain(">Acme<");
  });

  describe("whose Mates the list above shows", () => {
    afterEach(() => {
      setLocalStorageItem(MATE_SCOPE_STORAGE_KEY, "everyone", MateScopeSchema);
    });
    const checked = (html: string, scope: string) =>
      new RegExp(
        `<[^>]*aria-checked="true"[^>]*data-zerops-account-scope="${scope}"|<[^>]*data-zerops-account-scope="${scope}"[^>]*aria-checked="true"`,
        "u",
      ).test(html);

    it("offers Mine and Everyone, Everyone until the viewer chose otherwise, before the order", () => {
      const html = renderMenu();
      expect(html).toContain(">Show<");
      expect(checked(html, "everyone")).toBe(true);
      expect(checked(html, "mine")).toBe(false);
      expect(html.indexOf(">Show<")).toBeLessThan(html.indexOf(">Order<"));
    });

    it("checks Mine once the viewer chose it", () => {
      setLocalStorageItem(MATE_SCOPE_STORAGE_KEY, "mine", MateScopeSchema);
      expect(checked(renderMenu(), "mine")).toBe(true);
    });
  });

  describe("the order of the projects above", () => {
    afterEach(() => {
      setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "newest", ProjectOrderSchema);
    });
    const checked = (html: string, order: string) =>
      new RegExp(
        `<[^>]*aria-checked="true"[^>]*data-zerops-account-order="${order}"|<[^>]*data-zerops-account-order="${order}"[^>]*aria-checked="true"`,
        "u",
      ).test(html);

    it("offers Name, Creation date and Custom, in the words the projects page uses", () => {
      const html = renderMenu();
      expect(html).toContain(">Order<");
      for (const [order, label] of [
        ["name", "Name"],
        ["newest", "Creation date"],
        ["custom", "Custom"],
      ]) {
        expect(html).toContain(`data-zerops-account-order="${order}"`);
        expect(html).toContain(`>${label}<`);
      }
    });

    it.each(["name", "newest", "custom"] as const)(
      "checks %s when it is the order chosen",
      (order) => {
        setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, order, ProjectOrderSchema);
        const html = renderMenu();
        expect(checked(html, order)).toBe(true);
        for (const other of ["name", "newest", "custom"].filter((entry) => entry !== order)) {
          expect(checked(html, other)).toBe(false);
        }
      },
    );
  });

  it("keeps the item while a sign-out runs, and says where a failed one landed", () => {
    expect(renderMenu({ signingOut: true })).toContain('data-disabled=""');
    const failed = renderMenu({ signOutError: "Network is down." });
    expect(failed).toContain("Sign out failed. Try again");
    expect(failed).toContain('data-variant="destructive"');
  });
});
