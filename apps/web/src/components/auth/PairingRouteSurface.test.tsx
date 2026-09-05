import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PairingRouteSurface } from "./PairingRouteSurface";

vi.mock("../zerops/landing/ZeropsHostedLanding", () => ({
  ZeropsHostedLanding: () => <div>Zerops sign-in surface</div>,
}));

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
      createElement("a", { href: to, ...props }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PairingRouteSurface", () => {
  it("renders the Zerops sign-in instead of the rejected credential form", () => {
    vi.stubGlobal("window", {
      location: new URL("https://example.com/pair"),
    });

    const markup = renderToStaticMarkup(
      <PairingRouteSurface
        methods={["zerops-identity", "one-time-token"]}
        onAuthenticated={() => undefined}
      />,
    );

    expect(markup).toContain("Zerops sign-in surface");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("pairing-token");
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
