/**
 * A change's review leads with what it does: the description its author wrote — its pictures read
 * as the person from the app's own Gitea, holding their room, anything else a plain link — or what
 * the run that made it said, or nothing at all.
 */
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "~/zerops/__fixtures__/testDom";
import type { GiteaPictureSource } from "~/zerops/useGiteaPicture";

import { ReviewDescription } from "./ReviewDescription";

// The chat's renderer, down to what the description hands it: its text, and its pictures drawn by
// the review.
vi.mock("~/components/ChatMarkdown", async () => {
  const React = await import("react");
  const MarkdownPictureContext = React.createContext<
    | ((picture: { uri: string; alt: string; width: undefined; height: undefined }) => ReactNode)
    | null
  >(null);
  function ChatMarkdown({ text }: { readonly text: string }) {
    const draw = React.use(MarkdownPictureContext);
    const pictures = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/gu)];
    return (
      <div data-markdown={text}>
        {pictures.map(([, alt = "", uri = ""]) => (
          <React.Fragment key={uri}>
            {draw?.({ uri, alt, width: undefined, height: undefined })}
          </React.Fragment>
        ))}
      </div>
    );
  }
  return { default: ChatMarkdown, MarkdownPictureContext };
});

const GITEA = "https://git.example.test";
const NO_RUN = { words: undefined, reading: false } as const;

function source(): GiteaPictureSource & { readonly read: ReturnType<typeof vi.fn> } {
  return { ready: true, read: vi.fn(() => new Promise<Blob>(() => {})) };
}

function html(props: Partial<Parameters<typeof ReviewDescription>[0]> = {}): string {
  return renderToStaticMarkup(
    <ReviewDescription
      description={undefined}
      giteaOrigin={GITEA}
      onOpenRun={undefined}
      pictures={source()}
      run={NO_RUN}
      {...props}
    />,
  );
}

describe("what a change does, first", () => {
  it.each([
    [
      "its description, with the way back to the run that made it",
      { description: "Adds a **/status** page.", onOpenRun: () => {} },
      ["Description", "The run that made it", 'data-markdown="Adds a **/status** page."'],
    ],
    [
      "what the run said, where it wrote no description",
      { run: { words: "Added a /status route.", reading: false } },
      ["What it does", "Added a /status route."],
    ],
    [
      "the room of the run's words while its conversation is read",
      { run: { words: undefined, reading: true } },
      ["What it does", "rv-skeleton"],
    ],
  ] as const)("shows %s", (_case, props, words) => {
    const markup = html(props);
    for (const word of words) expect(markup).toContain(word);
  });

  it("shows nothing at all where neither said anything: no heading over no words", () => {
    expect(html()).toBe("");
  });

  it("points what Gitea wrote without its host at its Gitea", () => {
    expect(html({ description: "![The page](/attachments/5f1c2a)" })).toContain(
      `![The page](${GITEA}/attachments/5f1c2a)`,
    );
  });
});

describe("its pictures", () => {
  it("hold a screenshot's room while they are read", () => {
    const markup = html({ description: `![The page](${GITEA}/attachments/5f1c2a)` });
    expect(markup).toContain('data-state="reading"');
    expect(markup).toContain("aspect-ratio:16 / 10");
  });

  it("are a plain link where they are not on the app's own Gitea", () => {
    const markup = html({ description: "![A cat](https://pictures.example/cat.png)" });
    expect(markup).toContain('href="https://pictures.example/cat.png"');
    expect(markup).toContain(">A cat</a>");
    expect(markup).not.toContain("rv-pic");
  });

  it("say so quietly, with their words, where there is nothing to read", () => {
    const markup = html({ description: "![The page](data:image/png;base64,iVBORw0KGgo=)" });
    expect(markup).toContain('data-state="failed"');
    expect(markup).toContain("The page");
  });
});

describe("reading its pictures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the Gitea's as the person, and never one anywhere else", async () => {
    const document = new TestNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", {
      document,
      HTMLIFrameElement: TestNode,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal("HTMLIFrameElement", TestNode);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { createRoot } = await import("react-dom/client");
    const pictures = source();
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <ReviewDescription
            description={[
              "![The page](/attachments/5f1c2a)",
              "![A cat](https://pictures.example/cat.png)",
              `![Older](${GITEA}/snap/appdev/attachments/9e8d7c)`,
            ].join("\n\n")}
            giteaOrigin={GITEA}
            onOpenRun={undefined}
            pictures={pictures}
            run={NO_RUN}
          />,
        );
      });
      expect(pictures.read.mock.calls).toEqual([
        [`${GITEA}/attachments/5f1c2a`],
        [`${GITEA}/attachments/9e8d7c`],
      ]);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
