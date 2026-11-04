// @vitest-environment happy-dom
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// A conversation from before the engine recorded asks: its detail holds no ask record.
vi.mock("~/state/entities", () => ({ useThreadDetail: () => null }));

const { VaultRequestCardContainer } = await import("./VaultAskContainer");

const ASKED: ZeropsOperation = {
  key: "op:c1",
  kind: "env",
  phase: "done",
  anchorAt: "2026-10-01T10:00:00.000Z",
  anchorActivityId: "a1",
  turnId: "t1",
  subject: "the project",
  kicker: "Env · the project",
  voice: "Asking for STRIPE_SECRET_KEY.",
  voiceSource: "mate",
  statusWord: "Done",
  steps: [],
  links: [],
  callIds: ["c1"],
  hasResult: true,
  envChange: {
    action: "request",
    scope: "project",
    request: { key: "STRIPE_SECRET_KEY", sensitive: true, alreadySet: false },
  },
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("a value the Mate asked for in the conversation", () => {
  it("shows the operation as it read before the engine recorded asks, where no record holds it", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <VaultRequestCardContainer
          environmentId={"env-1" as EnvironmentId}
          fallback={<p>The operation as it read</p>}
          operation={ASKED}
          threadRef={{ environmentId: "env-1", threadId: "t-1" } as unknown as ScopedThreadRef}
        />,
      ),
    );
    expect(container.textContent).toBe("The operation as it read");
  });
});
