// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vite-plus/test";

import { mcpRunKey } from "./McpServers.logic";
import { useReadAgainWhen } from "./useMcpServers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("the Tools tab reads its tools again when the conversation's session starts and when a turn starts or ends", async () => {
  const idle = { phase: "disconnected", turnId: null, completedAt: null };
  const steps = [
    idle,
    { phase: "connecting", turnId: null, completedAt: null },
    { phase: "ready", turnId: null, completedAt: null },
    { phase: "running", turnId: "t1", completedAt: null },
    { phase: "running", turnId: "t1", completedAt: null },
    { phase: "ready", turnId: "t1", completedAt: "2026-11-04T21:00:00Z" },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let reads = 0;
  function Tab(props: { readonly runKey: string }) {
    useReadAgainWhen(props.runKey, () => {
      reads += 1;
    });
    return null;
  }
  const seen: number[] = [];
  try {
    for (const step of steps) {
      await act(() => root.render(<Tab runKey={mcpRunKey(step)} />));
      seen.push(reads);
    }
    // Not on opening; then on the session starting, being ready, the turn starting and ending —
    // and not again while nothing changed.
    expect(seen).toEqual([0, 1, 2, 3, 3, 4]);
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});
