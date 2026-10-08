// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ZeropsReviewDialog } from "./ZeropsReviewDialog";

let root: Root;
let from: HTMLButtonElement;
const press = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  press.mockClear();
  from = document.body.appendChild(document.createElement("button"));
  from.textContent = "Review";
  from.focus();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function show(safe: boolean) {
  await act(() =>
    root.render(
      <ZeropsReviewDialog
        open
        onOpenChange={() => {}}
        onClosed={() => {}}
        from={from}
        labelledBy="review-title"
      >
        <h2 id="review-title">Review change</h2>
        <textarea aria-label="Comment" />
        <button data-review-primary data-safe={String(safe)} onClick={press}>
          Merge
        </button>
      </ZeropsReviewDialog>,
    ),
  );
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.textContent).toBe(
    "Review change",
  );
  expect(dialog?.getAttribute("aria-modal")).toBe("true");
  return dialog!;
}
describe("the review is a layer: what is typed in it acts on nothing behind it", () => {
  it.each(["a", "Enter", "ArrowDown"])("keeps %s from listeners behind it", async (key) => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    try {
      const dialog = await show(true);
      await act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
      expect(behind).not.toHaveBeenCalled();
      expect(press).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", behind);
    }
  });
  it("presses its safe button with Command Enter, never from a field or while unsafe", async () => {
    const dialog = await show(false);
    const shortcut = () =>
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true });
    await act(() => dialog.dispatchEvent(shortcut()));
    expect(press).not.toHaveBeenCalled();
    await show(true);
    await act(() => dialog.querySelector("textarea")!.dispatchEvent(shortcut()));
    expect(press).not.toHaveBeenCalled();
    await act(() => dialog.dispatchEvent(shortcut()));
    expect(press).toHaveBeenCalledExactlyOnceWith(expect.anything());
  });
});
describe("the review takes the focus itself, never its button", () => {
  it("opens with the focus on the review, so a stray Enter presses nothing", async () => {
    const dialog = await show(true);
    expect(document.activeElement).toBe(dialog);
    await act(() =>
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(press).not.toHaveBeenCalled();
  });
  it("never moves the focus onto the button once it turns safe", async () => {
    const dialog = await show(false);
    expect(document.activeElement).toBe(dialog);
    await show(true);
    expect(document.activeElement).toBe(dialog);
  });
});
