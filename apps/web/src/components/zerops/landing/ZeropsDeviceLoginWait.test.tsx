import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsDeviceLoginWait } from "./ZeropsDeviceLoginWait";

const CONSENT = "https://app.zerops.io/authorize-login?request=req-1";
const noop = () => undefined;

describe("ZeropsDeviceLoginWait", () => {
  it("asks the person to finish in the Zerops window, with the code it shows and ways on", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeviceLoginWait
        onCancel={noop}
        onReopen={noop}
        stage={{
          kind: "waiting",
          url: `${CONSENT}&display=popup`,
          blocked: false,
          userCode: "ABCD-EFGH",
          windowMayBeOlder: false,
        }}
      />,
    );
    expect(markup).toContain("Finish in the Zerops window.");
    expect(markup).toContain("ABCD-EFGH");
    expect(markup).toContain("Open it again");
    expect(markup).toContain("Cancel");
  });

  it("hands a blocked window's consent page over as a link the person opens", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeviceLoginWait
        onCancel={noop}
        onReopen={noop}
        stage={{
          kind: "waiting",
          url: CONSENT,
          blocked: true,
          userCode: "ABCD-EFGH",
          windowMayBeOlder: false,
        }}
      />,
    );
    expect(markup).toContain("Your browser kept the Zerops window from opening.");
    expect(markup).toContain(`href="${CONSENT}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).not.toContain("Open it again");
  });

  it("offers only Cancel while the request is still starting", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeviceLoginWait onCancel={noop} onReopen={noop} stage={{ kind: "opening" }} />,
    );
    expect(markup).toContain("Finish in the Zerops window.");
    expect(markup).not.toContain("Open it again");
    expect(markup).toContain("Cancel");
  });

  it("names the code as the one to expect if Zerops shows one, never as already on screen", () => {
    // Signed out, the window first asks the person to log in or sign up, and Zerops may then let
    // Mate in without a code at all: only its approval page shows one.
    for (const blocked of [false, true]) {
      const markup = renderToStaticMarkup(
        <ZeropsDeviceLoginWait
          onCancel={noop}
          onReopen={noop}
          stage={{
            kind: "waiting",
            url: CONSENT,
            blocked,
            userCode: "ABCD-EFGH",
            windowMayBeOlder: false,
          }}
        />,
      );
      expect(markup).not.toMatch(/>\s*Zerops shows/u);
      expect(markup).toMatch(/If Zerops shows a code, it&#x27;s .*ABCD-EFGH/u);
    }
  });

  it("says the code may have changed once the request was renewed under an open window, and offers opening it again first", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeviceLoginWait
        onCancel={noop}
        onReopen={noop}
        stage={{
          kind: "waiting",
          url: `${CONSENT}&display=popup`,
          blocked: false,
          userCode: "WXYZ-0002",
          windowMayBeOlder: true,
        }}
      />,
    );
    expect(markup).toContain("the code in the Zerops window may have changed");
    expect(markup).not.toContain("If Zerops shows a code");
    expect(markup).toContain("WXYZ-0002");
    expect(markup.indexOf("Open it again")).toBeLessThan(markup.indexOf("WXYZ-0002"));
    expect(markup.match(/Open it again/gu)).toHaveLength(1);
    expect(markup).toContain("Cancel");
  });
});
