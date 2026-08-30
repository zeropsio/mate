import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsQuickAction } from "@t3tools/client-runtime/zerops/quickActions";
import { ZeropsQuickActions } from "./ZeropsQuickActions";

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
});
