/**
 * A change's review leads with what it does: the description its author wrote — its pictures read
 * as the person from the organization's HQ, holding their room, anything else a plain link — or
 * what the run that made it said, or nothing at all.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  makeAccountStore,
  pictureId,
  pictureLink,
  pictureScope,
} from "@t3tools/client-runtime/data";
import { parseAttachmentUrl } from "@t3tools/shared/hqChanges";
import { AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { elementsOf, TestNode } from "~/zerops/__fixtures__/testDom";
import type { ChangePictureSource } from "~/zerops/useProjectedHqPicture";

import { ReviewDescription as Description } from "./ReviewDescription";

const registry = AtomRegistry.make();
function ReviewDescription(props: Parameters<typeof Description>[0]) {
  return (
    <RegistryContext value={registry}>
      <Description {...props} />
    </RegistryContext>
  );
}

// The chat's renderer, down to what the description hands it: its text, and its pictures drawn by
// the review — a Markdown picture, or an <img> with the width and height rehype hands over as
// words.
vi.mock("~/components/ChatMarkdown", async () => {
  const React = await import("react");
  type Picture = {
    uri: string;
    alt: string;
    width: string | undefined;
    height: string | undefined;
  };
  const MarkdownPictureContext = React.createContext<((picture: Picture) => ReactNode) | null>(
    null,
  );
  function ChatMarkdown({ text }: { readonly text: string }) {
    const draw = React.use(MarkdownPictureContext);
    const pictures: Array<Picture> = [
      ...[...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/gu)].map(([, alt = "", uri = ""]) => ({
        uri,
        alt,
        width: undefined,
        height: undefined,
      })),
      ...[...text.matchAll(/<img alt="([^"]*)" width="(\d+)" height="(\d+)" src="([^"]+)">/gu)].map(
        ([, alt = "", width, height, uri = ""]) => ({ uri, alt, width, height }),
      ),
    ];
    return (
      <div data-markdown={text}>
        {pictures.map((picture) => (
          <React.Fragment key={picture.uri}>{draw?.(picture)}</React.Fragment>
        ))}
      </div>
    );
  }
  return { default: ChatMarkdown, MarkdownPictureContext };
});

const HQ = "https://hq.example.test";
/** Where the change keeps its pictures (`attachmentPath`). */
const PICTURES = "/api/apps/g1/changes/appdev/2/attachments";
const NO_RUN = { words: undefined, reading: false } as const;

function source(readBytes: (url: string) => Promise<Blob> = () => new Promise(() => {})) {
  const store = makeAccountStore(registry);
  const read = vi.fn(readBytes);
  const asked = new Set<string>();
  const source: ChangePictureSource & { readonly read: typeof read } = {
    read,
    data: store.data,
    key: (url) => {
      const link = parseAttachmentUrl(url, HQ);
      return link === null ? null : { orgId: "org", link };
    },
    demand: (ownerId) => {
      const link = pictureLink(ownerId);
      if (link === null) return () => {};
      const key = { orgId: "org", link };
      const id = pictureId(key);
      if (asked.has(id)) return () => {};
      asked.add(id);
      const scope = pictureScope(key);
      void read(`${HQ}${PICTURES}/${link.id}`).then(
        (blob) => {
          store.dispatch({
            kind: "baseline-commit",
            scope,
            generation: 0,
            via: "hq-stream",
            members: [id],
            rows: [
              {
                family: "hqPicture",
                id,
                value: blob,
                revision: { kind: "hq", incarnation: id, revision: 0 },
              },
            ],
          });
        },
        (cause: unknown) => {
          store.dispatch({
            kind: "stream",
            key: scope,
            now: 0,
            event: {
              kind: "fault",
              jitter: 0,
              fault: { outcome: "definitive-refusal", message: String(cause) },
            },
          });
        },
      );
      return () => {};
    },
  };
  return source;
}

function html(props: Partial<Parameters<typeof ReviewDescription>[0]> = {}): string {
  return renderToStaticMarkup(
    <ReviewDescription
      description={undefined}
      hqAddress={HQ}
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

  it("points what was written without its host at the official HQ", () => {
    expect(html({ description: `![The page](${PICTURES}/5f1c2a)` })).toContain(
      `![The page](${HQ}${PICTURES}/5f1c2a)`,
    );
  });
});

describe("its pictures", () => {
  it("stand as one line while they are read: their words, nothing to follow elsewhere", () => {
    const markup = html({ description: `![The page](${HQ}${PICTURES}/5f1c2a)` });
    expect(markup).toContain('class="rv-pic-line"');
    expect(markup).toContain("The page");
    expect(markup).not.toContain("href=");
    expect(markup).not.toContain("<img");
  });

  it("are a plain link where they are not the change's at the official HQ", () => {
    const markup = html({ description: "![A cat](https://pictures.example/cat.png)" });
    expect(markup).toContain('href="https://pictures.example/cat.png"');
    expect(markup).toContain(">A cat</a>");
    expect(markup).not.toContain("rv-pic");
  });

  it("hold the box their description gives from the first paint, their line in it", () => {
    const markup = html({
      description: `<img alt="The count" width="720" height="405" src="${HQ}${PICTURES}/5f1c2a">`,
    });
    expect(markup).toContain('data-box=""');
    expect(markup).toContain("aspect-ratio:720 / 405");
    expect(markup).toContain("width:min(100%, 720px)");
    expect(markup).toContain('class="rv-pic-line"');
    expect(markup).toContain("The count");
    expect(markup).not.toContain("<img");
  });

  it("say Picture where they give no words, with nothing to read", () => {
    const markup = html({ description: "![](data:image/png;base64,iVBORw0KGgo=)" });
    expect(markup).toContain('<span class="rv-pic-alt">Picture</span>');
  });
});

describe("reading its pictures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The test DOM, able to hold an icon's SVG. */
  class SvgNode extends TestNode {
    override createElement(name: string) {
      return new SvgNode(name, this);
    }
    createElementNS(_namespace: string, name: string) {
      return new SvgNode(name, this);
    }
  }

  /** The test DOM, and a root the description is drawn into. */
  async function mount() {
    const document = new SvgNode("#document", null, 9);
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
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    return { container, root };
  }

  it("reads the change's own as the person, and never one anywhere else", async () => {
    const { root } = await mount();
    const pictures = source();
    try {
      await act(async () => {
        root.render(
          <ReviewDescription
            description={[
              `![The page](${PICTURES}/5f1c2a)`,
              "![A cat](https://pictures.example/cat.png)",
              `![The phone](${HQ}${PICTURES}/9e8d7c)`,
            ].join("\n\n")}
            hqAddress={HQ}
            onOpenRun={undefined}
            pictures={pictures}
            run={NO_RUN}
          />,
        );
      });
      expect(pictures.read.mock.calls).toEqual([
        [`${HQ}${PICTURES}/5f1c2a`],
        [`${HQ}${PICTURES}/9e8d7c`],
      ]);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it("keeps a sized picture's box when it cannot be read, its line in it: nothing moves", async () => {
    const { container, root } = await mount();
    const refused = source(() => Promise.reject(new Error("HQ has no such picture.")));
    try {
      await act(async () => {
        root.render(
          <ReviewDescription
            description={`<img alt="The count" width="640" height="480" src="${HQ}${PICTURES}/5f1c2a">`}
            hqAddress={HQ}
            onOpenRun={undefined}
            pictures={refused}
            run={NO_RUN}
          />,
        );
      });
      const box = elementsOf(container, "span").find((node) => node.attributes.has("data-box"));
      expect(box?.style).toMatchObject({ aspectRatio: "640 / 480", width: "min(100%, 640px)" });
      expect(container.textContent).toContain("The count");
      expect(elementsOf(container, "img")).toEqual([]);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it("draws a sized picture in the same box once read, at the size its description gave", async () => {
    const { container, root } = await mount();
    const read = source(() =>
      Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })),
    );
    try {
      await act(async () => {
        root.render(
          <ReviewDescription
            description={`<img alt="The count" width="720" height="405" src="${HQ}${PICTURES}/7a8b9c">`}
            hqAddress={HQ}
            onOpenRun={undefined}
            pictures={read}
            run={NO_RUN}
          />,
        );
      });
      const box = elementsOf(container, "span").find((node) => node.attributes.has("data-box"));
      expect(box?.style).toMatchObject({ aspectRatio: "720 / 405", width: "min(100%, 720px)" });
      const [picture] = elementsOf(container, "img");
      expect(picture?.attributes.get("width")).toBe("720");
      expect(picture?.attributes.get("height")).toBe("405");
      expect(picture?.attributes.get("alt")).toBe("The count");
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it("settles a picture HQ does not hand over on its line, never on a spinner", async () => {
    const { container, root } = await mount();
    const refused = source(() => Promise.reject(new TypeError("Failed to fetch")));
    try {
      await act(async () => {
        root.render(
          <ReviewDescription
            description={`![The page on a phone](${HQ}${PICTURES}/unreachable)`}
            hqAddress={HQ}
            onOpenRun={undefined}
            pictures={refused}
            run={NO_RUN}
          />,
        );
      });
      const text = container.textContent;
      expect(text).toContain("The page on a phone");
      expect(elementsOf(container, "img")).toEqual([]);
      expect(elementsOf(container, "a")).toEqual([]);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
