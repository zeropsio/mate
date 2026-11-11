import type { DeviceLoginProgress } from "@zerops/session/session.device-login";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsDeviceLoginWait } from "./ZeropsDeviceLoginWait";

const CONSENT = "https://hq.zerops.io/authorize-login?request=req-1";
const noop = () => undefined;

const progress = (windowOpen: boolean): DeviceLoginProgress => ({
  userCode: "ABCD-EFGH",
  consentUrl: CONSENT,
  expiresAt: 0,
  windowOpen,
});

describe("ZeropsDeviceLoginWait", () => {
  // witness: apps/web/src/components/zerops/landing/ZeropsDeviceLoginWait.tsx | <p className="text-sm text-muted-foreground">Finish in the Zerops window.</p> → <p className="text-sm text-muted-foreground">Waiting.</p>
  it("asks the person to finish in the Zerops window, with the code it shows and ways on", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeviceLoginWait onCancel={noop} onReopen={noop} progress={progress(true)} />,
    );
    expect(markup).toContain("Finish in the Zerops window.");
    expect(markup).toContain("ABCD-EFGH");
    expect(markup).toContain("Reopen the Zerops window");
    expect(markup).toContain("Cancel");
  });

  // witness: apps/web/src/components/zerops/landing/ZeropsDeviceLoginWait.tsx | render={<a href={progress.consentUrl} rel="noopener" target="_blank" />} → render={<button type="button" />}
  it("hands a blocked window's consent page over as a link the person opens", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeviceLoginWait onCancel={noop} onReopen={noop} progress={progress(false)} />,
    );
    expect(markup).toContain("The Zerops window isn&#x27;t open.");
    expect(markup).toContain(`href="${CONSENT}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).not.toContain("Reopen the Zerops window");
  });

  // witness: apps/web/src/components/zerops/landing/ZeropsDeviceLoginWait.tsx | If Zerops shows a code, it's → Zerops shows
  it("names the code as the one to expect if Zerops shows one, never as already on screen", () => {
    // Signed out, the window first asks the person to log in or sign up, and Zerops may then let
    // Mate in without a code at all: only its approval page shows one.
    for (const windowOpen of [true, false]) {
      const markup = renderToStaticMarkup(
        <ZeropsDeviceLoginWait onCancel={noop} onReopen={noop} progress={progress(windowOpen)} />,
      );
      expect(markup).not.toMatch(/>\s*Zerops shows/u);
      expect(markup).toMatch(/If Zerops shows a code, it&#x27;s .*ABCD-EFGH/u);
    }
  });
});
