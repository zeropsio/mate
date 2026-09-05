import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsAccountControl } from "./ZeropsAccountControl";

describe("ZeropsAccountControl", () => {
  it("names the account and offers the way out", () => {
    const html = renderToStaticMarkup(
      <ZeropsAccountControl email="ada@example.com" onSignOut={() => {}} />,
    );
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Sign out");
    expect(html).not.toContain('disabled=""');
  });

  it("keeps the button while a sign-out runs, and says when one failed", () => {
    const busy = renderToStaticMarkup(
      <ZeropsAccountControl busy email={null} onSignOut={() => {}} />,
    );
    expect(busy).toContain('disabled=""');
    const failed = renderToStaticMarkup(
      <ZeropsAccountControl email={null} error="Network is down." onSignOut={() => {}} />,
    );
    expect(failed).toContain("Sign out failed. Try again");
  });
});
