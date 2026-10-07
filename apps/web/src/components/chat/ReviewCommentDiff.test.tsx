import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { ReviewCommentDiff } from "./ReviewCommentDiff";

const comment = {
  id: "review-1",
  filePath: "src/example.ts",
  diff: "@@ -1 +1 @@\n-old\n+new",
} as ReviewCommentContext;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Renderer() {
  return <div data-testid="loaded-diff">Rendered diff</div>;
}

describe("review diff demand", () => {
  it("loads once on drawing a diff and preserves raw content while pending", async () => {
    const pending = deferred<{ default: typeof Renderer }>();
    const loadRenderer = vi.fn(() => pending.promise);
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<div />);
    });
    expect(loadRenderer).toHaveBeenCalledTimes(0);
    await act(async () => {
      view.update(
        <ReviewCommentDiff comment={comment} theme="light" loadRenderer={loadRenderer} />,
      );
    });
    expect(loadRenderer).toHaveBeenCalledTimes(1);
    expect(view.root.findByType("pre").children.join("")).toBe(comment.diff);
    expect(view.root.findByProps({ role: "status" }).children.join("")).toBe("Loading diff...");
    await act(async () => {
      pending.resolve({ default: Renderer });
      await pending.promise;
    });
    expect(view.root.findByProps({ "data-testid": "loaded-diff" })).toBeDefined();
    await act(async () => {
      view.update(<ReviewCommentDiff comment={comment} theme="dark" loadRenderer={loadRenderer} />);
    });
    expect(loadRenderer).toHaveBeenCalledTimes(1);
    await act(async () => {
      view.unmount();
    });
  });

  it("shows a failed chunk with raw content and retries only on request", async () => {
    const failed = deferred<{ default: typeof Renderer }>();
    const recovered = deferred<{ default: typeof Renderer }>();
    const loadRenderer = vi
      .fn()
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(recovered.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let view!: ReactTestRenderer;
    try {
      await act(async () => {
        view = create(
          <ReviewCommentDiff comment={comment} theme="light" loadRenderer={loadRenderer} />,
        );
      });
      await act(async () => {
        failed.reject(new Error("chunk unavailable"));
        await failed.promise.catch(() => {});
      });
      expect(view.root.findByProps({ role: "alert" }).children.join("")).toBe(
        "Could not load diff.",
      );
      expect(view.root.findByType("pre").children.join("")).toBe(comment.diff);
      expect(loadRenderer).toHaveBeenCalledTimes(1);
      await act(async () => {
        view.root.findByType("button").props.onClick();
      });
      expect(loadRenderer).toHaveBeenCalledTimes(2);
      await act(async () => {
        recovered.resolve({ default: Renderer });
        await recovered.promise;
      });
      expect(view.root.findByProps({ "data-testid": "loaded-diff" })).toBeDefined();
    } finally {
      await act(async () => {
        view.unmount();
      });
      consoleError.mockRestore();
    }
  });
});
