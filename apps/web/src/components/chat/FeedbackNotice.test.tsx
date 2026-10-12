// @vitest-environment happy-dom
import { MessageId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { feedbackNotice } from "./FeedbackNotice";
import { NoticeAnnouncer, NoticeLine } from "./ConversationRows";

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
    // Notice derivation alone cannot protect the copy action its row actually offers.
    const item = feedbackNotice(
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
    await act(() => root?.render(<NoticeLine notice={item} />));
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

  it("failed feedback says its error whole and is announced once, outside the row", async () => {
    const error =
      "The upload to OpenAI was refused: the feedback endpoint answered 413 because the attached session log is larger than the 10 MB it accepts; trim the log or send without it.";
    const item = feedbackNotice(
      {
        id: MessageId.make("feedback-submission"),
        command: "/feedback The answer stopped early.",
        createdAt: "2026-10-08T10:00:00.000Z",
        status: "failed",
        errorMessage: error,
      } as never,
      () => {},
    );
    if (!item) throw new Error("Failed feedback must have a visible notice");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const draw = (rowMounted: boolean) =>
      act(() =>
        root?.render(
          <>
            <NoticeAnnouncer notices={[item]} />
            {rowMounted ? <NoticeLine notice={item} /> : null}
          </>,
        ),
      );
    await draw(true);
    const row = container.querySelector("[data-conversation-notice]")!;
    expect(row.textContent).toBe(`Could not send feedback to OpenAI · ${error}`);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const said = container.querySelector("[data-notice-announcer]")!;
    expect(said.getAttribute("aria-live")).toBe("assertive");
    expect(said.textContent).toBe(`Could not send feedback to OpenAI: ${error}`);
    // The list remounts the row as it scrolls; what is said stays the same node and words.
    await draw(false);
    await draw(true);
    expect(container.querySelector("[data-notice-announcer]")).toBe(said);
    expect(said.textContent).toBe(`Could not send feedback to OpenAI: ${error}`);
  });
});
