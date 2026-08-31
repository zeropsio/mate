import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const pillState = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
}));

vi.mock("./primitives", () => ({
  Pill: ({ label, onClick }: { readonly label: string; readonly onClick?: () => void }) => {
    if (onClick !== undefined) {
      pillState.handlers.set(label, onClick);
    }
    return <button data-zerops-primitive="pill">{label}</button>;
  },
}));

import type { ZeropsQuickAction } from "@t3tools/client-runtime/zerops/quickActions";
import { ZeropsQuickActions } from "./ZeropsQuickActions";

const actions: ReadonlyArray<ZeropsQuickAction> = [
  { id: "deploy", label: "Deploy", prompt: "Deploy kanbandev." },
  { id: "logs", label: "Show logs", prompt: "Show me the recent logs for kanbandev." },
];

describe("ZeropsQuickActions", () => {
  it("keeps actions as prompt-prefill affordances", () => {
    const onInsert = vi.fn();
    const html = renderToStaticMarkup(<ZeropsQuickActions actions={actions} onInsert={onInsert} />);

    expect(html).toContain("Deploy");
    expect(html).toContain("Show logs");
    expect(html).toContain("data-zerops-quick-actions");
    expect(html.match(/data-zerops-primitive="pill"/gu)).toHaveLength(2);

    pillState.handlers.get("Deploy")?.();
    pillState.handlers.get("Show logs")?.();
    expect(onInsert.mock.calls).toEqual([
      ["Deploy kanbandev."],
      ["Show me the recent logs for kanbandev."],
    ]);
  });

  it("renders nothing when the project offers no actions", () => {
    expect(renderToStaticMarkup(<ZeropsQuickActions actions={[]} />)).toBe("");
  });
});
