import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ReviewCommentContext } from "../../reviewCommentContext";

const { renderDiff } = vi.hoisted(() => ({ renderDiff: vi.fn() }));
vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: {
    fileDiff: { name: string };
    options: { theme: string; diffStyle: string };
  }) => {
    renderDiff(props);
    return <div>{props.fileDiff.name}</div>;
  },
}));
vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));

import ReviewCommentDiffRenderer from "./ReviewCommentDiffRenderer";
import * as diffRendering from "../../lib/diffRendering";

function comment(diff: string): ReviewCommentContext {
  return {
    id: "review-1",
    filePath: "src/example.ts",
    diff,
    fenceLanguage: "diff",
  } as ReviewCommentContext;
}

describe("review diff rendering", () => {
  it.each([
    ["light", "pierre-light"],
    ["dark", "pierre-dark"],
  ] as const)("renders partial patches in the %s theme", (theme, expectedTheme) => {
    renderDiff.mockClear();
    const markup = renderToStaticMarkup(
      <ReviewCommentDiffRenderer comment={comment("@@ -1 +1 @@\n-old\n+new")} theme={theme} />,
    );
    expect(markup).toContain("src/example.ts");
    expect(renderDiff).toHaveBeenCalledTimes(1);
    expect(renderDiff.mock.calls[0]?.[0].options).toEqual({
      collapsed: false,
      diffStyle: "unified",
      theme: expectedTheme,
    });
  });

  it("shows the parser raw fallback without mounting the renderer", () => {
    renderDiff.mockClear();
    vi.spyOn(diffRendering, "getRenderablePatch").mockReturnValueOnce({
      kind: "raw",
      text: "unrecognized patch <data>",
      reason: "Unsupported diff format.",
    });
    const markup = renderToStaticMarkup(
      <ReviewCommentDiffRenderer comment={comment("unrecognized patch <data>")} theme="light" />,
    );
    expect(markup).toContain("unrecognized patch &lt;data&gt;");
    expect(renderDiff).toHaveBeenCalledTimes(0);
    vi.restoreAllMocks();
  });

  it("draws nothing for an empty patch", () => {
    renderDiff.mockClear();
    expect(
      renderToStaticMarkup(<ReviewCommentDiffRenderer comment={comment("")} theme="dark" />),
    ).toBe("");
    expect(renderDiff).toHaveBeenCalledTimes(0);
  });
});
