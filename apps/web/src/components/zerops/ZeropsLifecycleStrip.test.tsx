import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsStripState } from "@t3tools/client-runtime/zerops/strip";
import { ZeropsStripLine } from "./ZeropsLifecycleStrip";

const render = (state: ZeropsStripState | undefined): string =>
  renderToStaticMarkup(<ZeropsStripLine onOpen={() => {}} state={state} />);

describe("ZeropsStripLine", () => {
  it("renders the phrase and marks its tone", () => {
    const html = render({ tone: "active", label: "developing kanbandev" });

    expect(html).toContain("developing kanbandev");
    expect(html).toContain('data-zerops-strip-tone="active"');
    expect(html).toContain("data-zerops-lifecycle-strip");
  });

  it("renders nothing when the thread has no Zerops state", () => {
    expect(render(undefined)).toBe("");
  });

  it("spins only while something is running", () => {
    expect(render({ tone: "active", label: "zerops_deploy running" })).toContain("animate-spin");
    expect(render({ tone: "done", label: "task complete" })).not.toContain("animate-spin");
  });

  it("colours a waiting strip differently from a finished one", () => {
    expect(render({ tone: "waiting", label: "waiting for you" })).toContain(
      "text-warning-foreground",
    );
    expect(render({ tone: "done", label: "task complete" })).toContain("text-success-foreground");
  });

  /** The tooltip popup is portalled and only exists once open, so the label a
   * screen reader gets is what the static markup can prove. */
  it("is a labelled button, so the map is one click away", () => {
    const html = render({ tone: "idle", label: "infrastructure ready · 3 services" });

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Zerops: infrastructure ready · 3 services"');
  });
});
