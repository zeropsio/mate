import type { VaultChange } from "@t3tools/client-runtime/data";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingVaultChanges } from "./ComposerPendingVaultChanges";

const change = (key: string, kind: VaultChange["kind"], sensitive: boolean): VaultChange => ({
  scope: { kind: "shared" },
  hostname: null,
  key,
  kind,
  sensitive,
  at: "2026-10-07T10:00:00Z",
  impact: { restart: [{ serviceId: "s1", hostname: "appdev" }], unread: false, literal: [] },
});

describe("ComposerPendingVaultChanges", () => {
  it("shows one chip per change, its key and what happened, never a value", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingVaultChanges
        changes={[
          change("STRIPE_SECRET_KEY", "added", true),
          change("LOG_LEVEL", "changed", false),
        ]}
        onRemove={() => {}}
      />,
    );
    expect(markup).toContain("STRIPE_SECRET_KEY added");
    expect(markup).toContain("LOG_LEVEL changed");
    expect(markup).toContain("Don&#x27;t tell about LOG_LEVEL changed");
  });

  it("draws nothing with nothing to tell", () => {
    expect(
      renderToStaticMarkup(<ComposerPendingVaultChanges changes={[]} onRemove={() => {}} />),
    ).toBe("");
  });
});
