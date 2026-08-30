import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PairingRouteSurface } from "./PairingRouteSurface";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PairingRouteSurface", () => {
  it("renders the Zerops sign-in and one-time-link fallback from the door methods", () => {
    vi.stubGlobal("window", {
      location: new URL("https://example.com/pair"),
    });

    const markup = renderToStaticMarkup(
      <PairingRouteSurface
        methods={["zerops-identity", "one-time-token"]}
        onAuthenticated={() => undefined}
      />,
    );

    expect(markup).toContain("This environment signs you in through Zerops.");
    expect(markup).toContain("Sign in through Zerops, or paste a one-time link.");
  });

  it("renders a phrase without a credential form when no method is offered", () => {
    vi.stubGlobal("window", {
      location: new URL("https://example.com/pair"),
    });

    const markup = renderToStaticMarkup(
      <PairingRouteSurface methods={[]} onAuthenticated={() => undefined} />,
    );

    expect(markup).toContain(
      "This environment offers no sign-in from here; ask an operator for a one-time link.",
    );
    expect(markup).toContain("No sign-in from here</h1>");
    expect(markup).not.toContain("Pair with this environment");
    expect(markup).not.toContain("<form");
  });
});
