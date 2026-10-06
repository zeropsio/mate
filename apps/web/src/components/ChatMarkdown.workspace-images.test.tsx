import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  resources: [] as Array<unknown>,
  assetState: "success" as "success" | "loading" | "failure",
  dimensions: undefined as { width: number; height: number } | undefined,
}));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../assets/assetUrls", () => ({
  useAssetUrlState: (_environmentId: unknown, resource: unknown) => {
    testState.resources.push(resource);
    if (testState.assetState === "loading") return { _tag: "Loading" };
    if (testState.assetState === "failure") return { _tag: "Failure" };
    return {
      _tag: "Success",
      url: "https://signed.test/workspace-image.svg",
      ...(testState.dimensions === undefined ? {} : { imageDimensions: testState.dimensions }),
    };
  },
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
}));
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectForChangeRequest: () => undefined,
  matchesLinkedPullRequestUrl: () => false,
  parseChangeRequestUrl: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import ChatMarkdown from "./ChatMarkdown";

const threadRef = {
  environmentId: EnvironmentId.make("env-windows"),
  threadId: ThreadId.make("thread-windows"),
};

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ChatMarkdown cwd={"C:\\Users\\shawn\\project"} threadRef={threadRef} text={markdown} />,
  );
}

function renderWithoutThread(markdown: string): string {
  return renderToStaticMarkup(<ChatMarkdown cwd={"C:\\Users\\shawn\\project"} text={markdown} />);
}

describe("ChatMarkdown workspace images", () => {
  beforeEach(() => {
    testState.resources = [];
    testState.assetState = "success";
  });

  it("loads every Windows workspace path form through a signed asset URL", () => {
    const imagePath = "C:/Users/shawn/project/.t3/workspace-image.svg";
    const html = render(
      [
        "![relative](.t3/workspace-image.svg)",
        `![absolute](${imagePath})`,
        `![file URL](file:///${imagePath})`,
        "![UNC file URL](file://server/share/workspace-image.svg)",
      ].join("\n\n"),
    );

    expect(testState.resources).toEqual([
      {
        _tag: "workspace-file",
        threadId: threadRef.threadId,
        path: "C:\\Users\\shawn\\project\\.t3\\workspace-image.svg",
      },
      { _tag: "workspace-file", threadId: threadRef.threadId, path: imagePath },
      { _tag: "workspace-file", threadId: threadRef.threadId, path: imagePath },
      {
        _tag: "workspace-file",
        threadId: threadRef.threadId,
        path: "\\\\server\\share\\workspace-image.svg",
      },
    ]);
    expect(html.match(/ src="https:\/\/signed\.test\/workspace-image\.svg"/g)).toHaveLength(4);
    expect(html.match(/max-w-\[min\(100%,30rem\)\]/g)).toHaveLength(4);
    expect(html.match(/max-h-\[30rem\]/g)).toHaveLength(4);
    expect(html).not.toContain("Image unavailable");
  });

  it("normalizes a drive-absolute src in raw image HTML", () => {
    const html = render(String.raw`<img src="D:\screens\workspace-image.svg" alt="raw">`);

    expect(testState.resources).toEqual([
      {
        _tag: "workspace-file",
        threadId: threadRef.threadId,
        path: "D:/screens/workspace-image.svg",
      },
    ]);
    expect(html).toContain("https://signed.test/workspace-image.svg");
  });

  it("uses a static placeholder while a signed asset URL loads", () => {
    testState.assetState = "loading";

    const html = render("![loading](.t3/workspace-image.svg)");

    expect(html).toContain('aria-label="Loading image"');
    expect(html).not.toContain("animate-pulse");
  });

  it("never passes a workspace source to a raw image when thread context is unavailable", () => {
    const html = renderWithoutThread(
      "![file URL](file:///C:/Users/shawn/project/workspace-image.svg)",
    );

    expect(testState.resources).toEqual([]);
    expect(html).toContain("Image unavailable");
    expect(html).not.toContain("file://");
  });

  it("blocks unsupported image schemes instead of passing them to a raw image", () => {
    const html = render("![unsupported](content://media/image/1)");

    expect(testState.resources).toEqual([]);
    expect(html).toContain("Image unavailable");
    expect(html).not.toContain("content://");
  });

  it("keeps remote images directly loadable", () => {
    const html = render("![remote](https://example.com/image.png)");

    expect(testState.resources).toEqual([]);
    expect(html).toContain('src="https://example.com/image.png"');
    expect(html).toContain("max-w-[min(100%,30rem)]");
    expect(html).toContain("max-h-[30rem]");
    expect(html).not.toContain("Image unavailable");
  });
});

describe("a picture's room before it loads", () => {
  beforeEach(() => {
    testState.assetState = "success";
    testState.dimensions = undefined;
  });

  // The server reads a workspace picture's size from its header as it signs
  // its address: the picture stands in its own box before a byte has come,
  // and loading it moves nothing (the owner, 2026-10-05: "it shifts layout,
  // because it only gets its size after its loaded").
  it("stands at the size its Mate read from the file before a byte has come", () => {
    testState.dimensions = { width: 1200, height: 800 };
    const html = render("![shop](.t3/storefront-home.png)");
    expect(html).toMatch(/<img[^>]*height="800"/);
    expect(html).toMatch(/<img[^>]*width="1200"/);
    expect(html).not.toContain("aspect-video");
    expect(html).toMatch(/<img[^>]*style="width:min\(1200px, 30rem, calc\(30rem \* 1\.5\)\)"/);
  });

  // Slow bytes are not missing ones: a picture whose bytes failed asks for
  // them again after a wait, and only then is said to be unavailable.
  it("asks again for bytes that failed before it says the picture is unavailable", () => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      let renderer: ReturnType<typeof create> | undefined;
      act(() => {
        renderer = create(
          <ChatMarkdown cwd="/srv/app" threadRef={threadRef} text="![shop](.t3/slow.png)" />,
        );
      });
      const image = () =>
        renderer!.root.findAll(
          (node) => node.type === "img" && node.props["data-markdown-image"] !== undefined,
        );
      const shown = () => JSON.stringify(renderer!.toJSON());
      for (const wait of [1_500, 4_000]) {
        act(() => image()[0]!.props.onError());
        expect(shown()).not.toContain("Image unavailable");
        act(() => vi.advanceTimersByTime(wait));
        expect(image()).toHaveLength(1);
      }
      act(() => image()[0]!.props.onError());
      expect(shown()).toContain("Image unavailable");
      act(() => renderer!.unmount());
    } finally {
      vi.useRealTimers();
    }
  });

  // A picture without a shape took no room until its bytes came, and the list
  // draws a row again whenever it recycles it: opening a conversation, its
  // pictures grew from nothing and everything in sight jumped (2026-09-29).
  it("holds the room a picture usually takes the first time it is seen", () => {
    const html = render("![first](.t3/first-sight.png)");
    expect(html).toMatch(/<img[^>]*class="[^"]*aspect-video w-full[^"]*"/);
    expect(html).not.toMatch(/<img[^>]*width=/);
    // Inside its opener, the opener is as wide as that room: a width in
    // percent inside a button that shrinks to its content is no width.
    const opened = renderToStaticMarkup(
      <ChatMarkdown
        cwd={"C:\\Users\\shawn\\project"}
        onOpenImage={() => undefined}
        threadRef={threadRef}
        text="![first](.t3/first-sight-opened.png)"
      />,
    );
    expect(opened).toMatch(
      /<button[^>]*class="[^"]*w-full max-w-\[30rem\][^"]*"[^>]*data-markdown-image-opener/,
    );
    // A picture from an address of its own is as often a badge: no 16:9 place.
    expect(render("![badge](https://example.com/badge.svg)")).not.toContain("aspect-video");
  });

  it("holds its own shape from its first frame once it has been seen", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const markdown = "![seen](https://example.com/seen-before.png)";
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(<ChatMarkdown cwd="/srv/app" threadRef={threadRef} text={markdown} />);
    });
    const image = renderer!.root.find(
      (node) => node.type === "img" && node.props["data-markdown-image"] !== undefined,
    );
    act(() => {
      image.props.onLoad({ currentTarget: { naturalWidth: 800, naturalHeight: 600 } });
    });
    act(() => renderer!.unmount());

    const html = render(markdown);
    expect(html).toMatch(/<img[^>]*height="600"/);
    expect(html).toMatch(/<img[^>]*width="800"/);
    expect(html).not.toContain("aspect-video");
    // A width it will stand at, so the attributes' ratio gives its height
    // before a byte has come — `w-auto` alone left it none.
    expect(html).toMatch(
      /<img[^>]*style="width:min\(800px, 30rem, calc\(30rem \* 1\.3333333333333333\)\)"/,
    );
  });
});
