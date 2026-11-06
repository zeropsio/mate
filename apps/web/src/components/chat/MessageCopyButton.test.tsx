// @vitest-environment happy-dom

import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { MessageCopyButton } from "./MessageCopyButton";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("copying a message with structured context identifies and copies the whole message", async () => {
  const text =
    '<review_comment filePath="src/example.ts">Review this change</review_comment>\nKeep the surrounding message.';
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(<MessageCopyButton text={text} />);
    });
    const button = renderer!.root.findByType("button");
    expect(button.props["aria-label"]).toBe("Copy message");
    await act(async () => {
      button.props.onClick({});
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(renderer!.root.findByType("button").props["aria-label"]).toBe("Copy message");
  } finally {
    await act(async () => renderer?.unmount());
  }
});
