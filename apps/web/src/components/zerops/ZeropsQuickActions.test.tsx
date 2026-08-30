import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsQuickAction } from "../../zerops/quickActions";
import { ZeropsQuickActions } from "./ZeropsQuickActions";
import quickActionsSource from "./ZeropsQuickActions.tsx?raw";

const actions: ReadonlyArray<ZeropsQuickAction> = [
  { id: "deploy", label: "Deploy", prompt: "Deploy kanbandev." },
  { id: "logs", label: "Show logs", prompt: "Show me the recent logs for kanbandev." },
];

describe("ZeropsQuickActions", () => {
  it("renders one button per action", () => {
    const html = renderToStaticMarkup(<ZeropsQuickActions actions={actions} />);

    expect(html).toContain("Deploy");
    expect(html).toContain("Show logs");
    expect(html).toContain("data-zerops-quick-actions");
  });

  it("renders nothing when the project offers no actions", () => {
    expect(renderToStaticMarkup(<ZeropsQuickActions actions={[]} />)).toBe("");
  });

  /**
   * The brief's rule: composer prefill only, no direct API calls. A quick
   * action that could mutate Zerops would be a second orchestration path
   * beside the agent — so this asserts the module has no way to make one.
   */
  it("cannot reach Zerops or the RPC layer at all", () => {
    expect(quickActionsSource).not.toContain("WS_METHODS");
    expect(quickActionsSource).not.toContain("useAtomCommand");
    expect(quickActionsSource).not.toContain("zeropsApi");
    expect(quickActionsSource).not.toContain("fetch(");
  });
});
