// @vitest-environment happy-dom
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The conversation's detail as it stands: not loaded yet (`null`), or loaded with no ask record.
const thread: { detail: { readonly activities: ReadonlyArray<unknown> } | null } = { detail: null };
vi.mock("~/state/entities", () => ({
  useThreadDetail: (_ref: unknown, select: (detail: unknown) => unknown) => select(thread.detail),
}));

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

/** What the person sees of it: nothing hidden from them while its room is held. */
const shown = (container: HTMLElement): string => {
  const copy = container.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  return copy.textContent ?? "";
};

async function draw(): Promise<HTMLElement> {
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
  return container;
}

describe("a value the Mate asked for in the conversation", () => {
  it("shows the operation as it read before the engine recorded asks, where no record holds it", async () => {
    thread.detail = { activities: [] };
    expect(shown(await draw())).toBe("The operation as it read");
  });

  it("a new ask never shows the operation card first: until the conversation is read, neither shows", async () => {
    thread.detail = null;
    expect(shown(await draw())).toBe("");
  });
});
