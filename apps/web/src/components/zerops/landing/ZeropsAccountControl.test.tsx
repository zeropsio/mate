import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Menu } from "../../ui/menu";
import { ZeropsAccountControl, ZeropsAccountMenu } from "./ZeropsAccountControl";
import { zeropsAccountDisplay } from "./ZeropsAccountControl.logic";

const ADA = zeropsAccountDisplay({
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  firstName: "Ada",
  avatar: { smallAvatarUrl: "https://cdn/ada.png" },
});

const NAMELESS = zeropsAccountDisplay({ email: "ops@example.com" });

describe("ZeropsAccountControl", () => {
  it("shows the person, not their address: picture and first name on the trigger", () => {
    const html = renderToStaticMarkup(<ZeropsAccountControl account={ADA} onSignOut={() => {}} />);
    expect(html).toContain('data-zerops-account-control="true"');
    expect(html).toContain('src="https://cdn/ada.png"');
    expect(html).toContain(">Ada<");
    expect(html).toContain('aria-label="Account: Ada"');
    expect(html).not.toContain("ada@example.com");
    expect(html).not.toContain("Sign out");
  });

  it("falls back to initials and the email's local part when the account has neither", () => {
    const html = renderToStaticMarkup(
      <ZeropsAccountControl account={NAMELESS} onSignOut={() => {}} />,
    );
    expect(html).toContain('data-zerops-avatar="initials"');
    expect(html).toContain(">O<");
    expect(html).toContain(">ops<");
  });
});

describe("ZeropsAccountMenu", () => {
  const render = (props: Partial<Parameters<typeof ZeropsAccountMenu>[0]> = {}) =>
    renderToStaticMarkup(
      <Menu>
        <ZeropsAccountMenu account={ADA} onSignOut={() => {}} {...props} />
      </Menu>,
    );

  it("names the account in full, with its email, then offers the way out", () => {
    const html = render();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Sign out");
    expect(html).not.toContain('data-disabled=""');
  });

  it("keeps the item while a sign-out runs, and says when one failed", () => {
    expect(render({ busy: true })).toContain('data-disabled=""');
    const failed = render({ error: "Network is down." });
    expect(failed).toContain("Sign out failed. Try again");
    expect(failed).toContain('data-variant="destructive"');
  });
});
