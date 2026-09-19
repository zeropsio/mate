import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

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

  it("names the account in full, with its address", () => {
    const html = renderMenu();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
  });

  it("folds every place the foot used to spend a glyph on", () => {
    const html = renderMenu();
    for (const id of ["projects", "gitea", "usage", "settings"]) {
      expect(html).toContain(`data-zerops-account-destination="${id}"`);
    }
    expect(html).toContain("Sign out");
  });

  it("names the page that is already open rather than lighting nothing", () => {
    expect(renderMenu({ destination: "usage" })).toContain(">Open<");
    expect(renderMenu({ destination: null })).not.toContain(">Open<");
  });

  it("offers no organization switcher when the account has one", () => {
    expect(renderMenu({ organizations: [ZEROPS] })).not.toContain("Organization");
  });

  it("offers every organization once there is a choice to make", () => {
    const html = renderMenu({ organizations: [ZEROPS, ACME] });
    expect(html).toContain("Organization");
    expect(html).toContain(">Acme<");
  });

  it("keeps the item while a sign-out runs, and says where a failed one landed", () => {
    expect(renderMenu({ signingOut: true })).toContain('data-disabled=""');
    const failed = renderMenu({ signOutError: "Network is down." });
    expect(failed).toContain("Sign out failed. Try again");
    expect(failed).toContain('data-variant="destructive"');
  });
});
