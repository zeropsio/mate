/**
 * What was said on a change, in the review, and the one box to say something back: Comment keeps
 * the words on the change, Ask hands them to the person's own Mate, who changes the code — told
 * apart by what they do, with no line explaining them.
 */
import {
  changeRemarks,
  preferredMateTint,
  type ChangeRemark,
} from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { elementsOf, TestNode } from "~/zerops/__fixtures__/testDom";
import type {
  ZeropsChangeComments,
  ZeropsChangeCommentsState,
} from "~/zerops/useZeropsChangeComments";

import { ReviewConversation } from "./ReviewConversation";

const NOW = Date.parse("2026-09-29T12:00:00Z");

function remarks(count = 2): ReadonlyArray<ChangeRemark> {
  return changeRemarks({
    comments: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      author: index % 2 === 0 ? "ales" : "mate-p-nova",
      avatarUrl: undefined,
      body: index % 2 === 0 ? `The cache key ignores the locale (${String(index)}).` : "Fixed.",
      at: "2026-09-29T11:00:00Z",
    })),
    mateNames: new Map([["p-nova", "Nova"]]),
    me: "ales",
  });
}

function comments(
  state: ZeropsChangeCommentsState,
  over: Partial<ZeropsChangeComments> = {},
): ZeropsChangeComments {
  return { state, say: async () => null, saying: false, retry: () => {}, ...over };
}

function html(props: Partial<Parameters<typeof ReviewConversation>[0]> = {}): string {
  return renderToStaticMarkup(
    <ReviewConversation
      asker={{ name: "Nova", tint: "slate" }}
      comments={comments({ kind: "read", comments: [] })}
      count={2}
      draftKey="appdev#2"
      frame="page"
      now={NOW}
      onAsk={async () => {}}
      remarks={remarks()}
      {...props}
    />,
  );
}

describe("a change's conversation in its review", () => {
  it("shows what was said, the Mate by its name and never its bot login", () => {
    const markup = html();
    expect(markup).toContain("The cache key ignores the locale (0).");
    expect(markup).toContain("Nova");
    expect(markup).not.toContain("mate-p-nova");
    expect(markup).toContain("2 comments");
  });

  it.each([
    ["the person's own Mate: both verbs", { name: "Nova", tint: "slate" as const }, true],
    ["nobody's to ask: Comment alone", undefined, false],
  ])("offers %s", (_case, asker, asks) => {
    const markup = html({ asker });
    expect(markup).toContain(">Comment</button>");
    expect(markup.includes("Ask Nova")).toBe(asks);
  });

  /**
   * A Mate's remark wears the face the menu gives it — its person's pick — rather than the tint
   * its name alone asks for; a Mate the project no longer lists still gets that one.
   */
  it.each([
    {
      case: "the face the project gives it",
      mateFaces: new Map([["p-nova", { tint: "rose" as const, shape: "seal" as const }]]),
      face: 'data-mate-face-shape="seal" data-mate-face-size="sm" data-mate-face-state="idle" data-mate-face-tint="rose"',
    },
    {
      case: "the tint its name asks for once the project no longer lists it",
      mateFaces: new Map(),
      face: `data-mate-face-tint="${preferredMateTint("Nova")}"`,
    },
  ])("draws a Mate's remark in $case", ({ mateFaces, face }) => {
    expect(html({ mateFaces })).toContain(face);
  });

  it("draws Ask in the face its person picked", () => {
    const markup = html({ asker: { name: "Nova", tint: "slate", shape: "clover" } });
    expect(markup).toContain('data-mate-face-shape="clover" data-mate-face-size="dot"');
  });

  it("tells the verbs apart without a line explaining them", () => {
    const markup = html();
    expect(markup).toContain('placeholder="Comment, or tell Nova what to change…"');
    expect(markup).not.toContain("Asking with an empty box");
    expect(markup).not.toContain("rv-note");
  });

  it("takes no press of either verb with nothing written, and still says what each does", () => {
    const markup = html();
    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Comment<\/button>/u);
    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*>.*Ask Nova<\/button>/u);
    expect(markup).not.toMatch(/<button[^>]*disabled=""/u);
  });

  it.each([
    ["the page: every comment", "page", 9, 9, false],
    ["the dialog: the newest three, the rest one press away", "dialog", 9, 3, true],
  ] as const)("shows, on %s", (_case, frame, count, shown, folded) => {
    const markup = html({ frame, remarks: remarks(count), count });
    expect(markup.match(/data-zerops-surface="zerops-change-remark"/gu)?.length).toBe(shown);
    expect(markup.includes("Show 6 earlier")).toBe(folded);
  });

  it("holds the room of the comments it has while they are read", () => {
    const markup = html({ comments: comments({ kind: "reading" }), count: 2, remarks: [] });
    expect(markup.match(/class="rv-remark-skeleton"/gu)?.length).toBe(2);
    // The box is there from the first frame: nothing under it moves when what was said arrives.
    expect(markup).toContain("rv-say-box");
  });

  it("says what could not be read, with Try again, and still takes words", () => {
    const markup = html({
      comments: comments({ kind: "failed", reason: "Gitea did not answer in time." }),
      remarks: [],
    });
    expect(markup).toContain("The conversation couldn&#x27;t be read.");
    expect(markup).toContain("Gitea did not answer in time.");
    expect(markup).toContain(">Try again</button>");
    expect(markup).toContain("rv-say-box");
  });

  it("asks for a sign-in with no Gitea to read from, and takes nothing", () => {
    const markup = html({ comments: comments({ kind: "no-gitea" }), remarks: [] });
    expect(markup).toContain("Sign in to Gitea to read what was said here.");
    expect(markup).toMatch(/<textarea[^>]*disabled=""/u);
  });

  it("never sends anybody to Gitea to take part", () => {
    expect(html()).not.toContain("<a ");
  });
});

describe("the box", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The test DOM, able to hold the Mate's face: an SVG, its style set property by property. */
  class FaceNode extends TestNode {
    override readonly style = { setProperty() {}, removeProperty() {} };
    override createElement(name: string) {
      return new FaceNode(name, this);
    }
    createElementNS(_namespace: string, name: string) {
      return new FaceNode(name, this);
    }
  }

  async function mount(conversation: ZeropsChangeComments, onAsk: (said: string) => Promise<void>) {
    const document = new FaceNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", {
      document,
      Element: TestNode,
      HTMLElement: TestNode,
      HTMLIFrameElement: TestNode,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal("HTMLIFrameElement", TestNode);
    vi.stubGlobal("Element", TestNode);
    vi.stubGlobal("HTMLElement", TestNode);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    await act(async () => {
      root.render(
        <ReviewConversation
          asker={{ name: "Nova", tint: "slate" }}
          comments={conversation}
          count={0}
          draftKey={`appdev#${String(Math.random())}`}
          frame="dialog"
          now={NOW}
          onAsk={onAsk}
          remarks={[]}
        />,
      );
    });
    const props = (node: TestNode) => {
      const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
      return (key === undefined ? {} : (node as never)[key]) as Record<
        string,
        (event: unknown) => void
      >;
    };
    const box = elementsOf(container, "textarea")[0];
    if (box === undefined) throw new Error("no box");
    const type = async (text: string) => {
      await act(async () => {
        props(box).onChange?.({ target: { value: text } });
      });
    };
    const press = async (words: string) => {
      const button = elementsOf(container, "button").find((node) =>
        node.textContent.includes(words),
      );
      if (button === undefined) throw new Error(`no ${words}`);
      await act(async () => {
        props(button).onClick?.({ currentTarget: button });
      });
    };
    const key = async (event: Record<string, unknown>) => {
      await act(async () => {
        props(box).onKeyDown?.({ preventDefault() {}, repeat: false, ...event });
      });
    };
    return { type, press, key, unmount: () => act(async () => root.unmount()) };
  }

  it("comments what was written, and ⌘↵ in it comments too", async () => {
    const say = vi.fn(async () => null);
    const box = await mount(comments({ kind: "read", comments: [] }, { say }), async () => {});
    await box.type("Looks right to me.");
    await box.press("Comment");
    await box.type("One more thing.");
    await box.key({ key: "Enter", metaKey: true, ctrlKey: false });
    expect(say.mock.calls).toEqual([["Looks right to me."], ["One more thing."]]);
    await box.unmount();
  });

  it("hands what was written to the Mate on Ask", async () => {
    const onAsk = vi.fn(async () => {});
    const box = await mount(comments({ kind: "read", comments: [] }), onAsk);
    await box.type("  Rename the route to /health/full.  ");
    await box.press("Ask Nova");
    expect(onAsk.mock.calls).toEqual([["Rename the route to /health/full."]]);
    await box.unmount();
  });
});
