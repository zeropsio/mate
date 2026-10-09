// @vitest-environment happy-dom
import { MessageId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { feedbackBannerItem } from "./ComposerFeedback";
import { ComposerBannerStack } from "./ComposerBannerStack";

vi.mock("../../hooks/useCopyToClipboard", () => ({
  writeTextToClipboard: vi.fn(async () => undefined),
}));

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Codex feedback", () => {
  it("sent feedback shows the reported thread ID and copies that ID", async () => {
    // Notice derivation alone cannot protect the copy action the composer actually offers.
    const item = feedbackBannerItem(
      {
        id: MessageId.make("feedback-submission"),
        command: "/feedback The answer stopped early.",
        createdAt: "2026-10-08T10:00:00.000Z",
        status: "sent",
        feedbackId: "reported-codex-thread",
      },
      () => {},
    );
    if (!item) throw new Error("Sent feedback must have a visible notice");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() => root?.render(<ComposerBannerStack items={[item]} />));
    expect(container.textContent).toContain("Feedback sent to OpenAI");
    expect(container.textContent).toContain("Thread ID: reported-codex-thread");
    const copy = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Copy ID",
    );
    if (!copy) throw new Error("Sent feedback must have a visible Copy ID action");
    await act(() => copy.click());
    expect(writeTextToClipboard).toHaveBeenCalledExactlyOnceWith(
      "reported-codex-thread",
      "Codex feedback thread ID",
    );
  });
});
