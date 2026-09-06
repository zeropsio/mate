import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadSyncIndicator, ThreadSyncStatusPill } from "./ThreadSyncStatusPill";

describe("ThreadSyncIndicator", () => {
  it.each([
    ["loading", "Loading messages..."],
    ["syncing", "Syncing messages..."],
  ] as const)("is a small spinner that says %s on hover", (phase, label) => {
    const markup = renderToStaticMarkup(<ThreadSyncIndicator phase={phase} />);

    expect(markup).toContain('data-thread-sync-indicator="true"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain(`aria-label="${label}"`);
    // Fixed size: it sits in a slot the header keeps whether or not it spins.
    expect(markup).toContain("size-4");
    // Never the drawer that pushed the composer down.
    expect(markup).not.toContain("chat-composer-drawer");
  });
});

describe("ThreadSyncStatusPill", () => {
  it("renders nothing where the chat view mounts it — the indicator lives in the header's slot", () => {
    expect(renderToStaticMarkup(<ThreadSyncStatusPill phase="syncing" />)).toBe("");
  });
});
