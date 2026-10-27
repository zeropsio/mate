// @vitest-environment happy-dom
import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NoticesOverComposer } from "./NoticesOverComposer";
import { usageLimitsNotice } from "./UsageLimitsNotice";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// With no conversation to hold it (a fresh draft's hero, an empty conversation), the notice is
// still seen: in its row's look, just above the composer.
describe("a notice with no conversation to hold it", () => {
  it.each([
    { name: "the /usage-limits answer", shown: true },
    { name: "nothing", shown: false },
  ])("stands above the composer in its row's look: $name", async ({ shown }) => {
    const dismiss = vi.fn();
    const notices = shown
      ? [
          usageLimitsNotice(
            "usage-limits:1",
            {
              createdAt: "2026-10-12T10:00:00.000Z",
              accounts: [],
              notices: ["No limits reported."],
            },
            EnvironmentId.make("env"),
            dismiss,
          ),
        ]
      : [];
    await act(() => root!.render(<NoticesOverComposer notices={notices} />));
    const rows = document.querySelectorAll(
      "[data-notices-over-composer] [data-conversation-notice]",
    );
    expect(rows).toHaveLength(shown ? 1 : 0);
    if (!shown) return;
    expect(rows[0]!.textContent).toContain("Usage limits");
    await act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="Dismiss usage limits"]')!.click(),
    );
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
