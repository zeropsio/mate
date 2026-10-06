/**
 * What was said on a change, in the review, and the one box to say something back: Comment keeps
 * the words on the change, Ask hands them to the person's own Mate, who changes the code — told
 * apart by what they do, with no line explaining them.
 */
import { changeRemarks, type ChangeRemark } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { elementsOf, TestNode } from "~/zerops/__fixtures__/testDom";
import type { ChangeDiscussion } from "~/zerops/useChangeDiscussion";

import { ReviewConversation } from "./ReviewConversation";

const NOW = Date.parse("2026-09-29T12:00:00Z");

/** The organization's members by their Zerops user id. */
const MEMBERS = new Map([
  ["u-ales", "Aleš"],
  ["u-wren", "Wren"],
]);

function remarks(count = 2): ReadonlyArray<ChangeRemark> {
  return changeRemarks({
    comments: Array.from({ length: count }, (_, index) => ({
      id: `c${String(index + 1)}`,
      authorUserId: index % 2 === 0 ? "u-ales" : "u-wren",
      authorMateProjectId: null,
      body: index % 2 === 0 ? `The cache key ignores the locale (${String(index)}).` : "Fixed.",
      createdAt: "2026-09-29T11:00:00Z",
    })),
    nameOf: (userId) => MEMBERS.get(userId),
    mateNameOf: () => undefined,
    me: "u-ales",
  });
}

function comments(
  state: ChangeDiscussion["state"],
  over: Partial<ChangeDiscussion> = {},
): ChangeDiscussion {
  return {
    state,
    say: async () => null,
    saying: false,
    waiting: false,
    pending: null,
    landed: null,
    retry: () => {},
    ...over,
  };
}

function html(props: Partial<Parameters<typeof ReviewConversation>[0]> = {}): string {
  return renderToStaticMarkup(
    <ReviewConversation
      asker={{ name: "Nova", tint: "slate" }}
      commentable
      comments={comments({ kind: "read", comments: [] })}
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
  it("shows what was said, each person by their name and never their id", () => {
    const markup = html();
    expect(markup).toContain("The cache key ignores the locale (0).");
    expect(markup).toContain("Wren");
    expect(markup).not.toContain("u-wren");
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

  // HQ's rule (`comment_change`) does not let them say anything on it: neither verb is offered —
  // Ask keeps the words on the change too — and what was said still shows.
  it("offers no box to a person who may not comment on the change", () => {
    const markup = html({ commentable: false });
    expect(markup).toContain("The cache key ignores the locale (0).");
    expect(markup).not.toContain("rv-say-box");
    expect(markup).not.toContain(">Comment</button>");
    expect(markup).not.toContain("Ask Nova");
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

  it("says a press waits until the conversation is read", () => {
    const markup = html({
      comments: comments({ kind: "reading" }, { saying: true, waiting: true }),
    });
    expect(markup.includes("Sends once HQ has read the conversation.")).toBe(true);
  });

  it.each([
    { reconnecting: false, line: false },
    { reconnecting: true, line: true },
  ])(
    "shows words HQ took, off, until its conversation holds them (reconnecting: $reconnecting)",
    ({ reconnecting, line }) => {
      const markup = html({
        comments: comments(
          { kind: "read", comments: [] },
          { saying: true, pending: { body: "Ship it", reconnecting } },
        ),
      });
      expect(markup).toMatch(/<textarea[^>]*readOnly=""[^>]*>Ship it<\/textarea>/u);
      expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Comment<\/button>/u);
      expect(markup.includes("HQ is reconnecting. Your comment shows here once HQ has it.")).toBe(
        line,
      );
    },
  );

  it.each([
    ["the page: every comment", "page", 9, 9, false],
    ["the dialog: the newest three, the rest one press away", "dialog", 9, 3, true],
  ] as const)("shows, on %s", (_case, frame, count, shown, folded) => {
    const markup = html({ frame, remarks: remarks(count) });
    expect(markup.match(/data-zerops-surface="zerops-change-remark"/gu)?.length).toBe(shown);
    expect(markup.includes("Show 6 earlier")).toBe(folded);
  });

  it("takes words from the first frame, while what was said is still read", () => {
    const markup = html({ comments: comments({ kind: "reading" }), remarks: [] });
    expect(markup).toContain("rv-say-box");
    expect(markup).not.toMatch(/<textarea[^>]*disabled=""/u);
  });

  // The room is held from the first frame: nothing under it moves when what was said arrives.
  it.each([
    ["the page: one row per comment", "page", 2, 2, false],
    ["the dialog: the newest three, and the fold's line", "dialog", 9, 3, true],
    ["a change nobody commented on: none", "page", 0, 0, false],
    ["a change HQ counted none of: none", "page", undefined, 0, false],
  ] as const)(
    "holds the room of the comments it has while they are read, on %s",
    (_case, frame, count, rows, folded) => {
      const markup = html({ comments: comments({ kind: "reading" }), count, frame, remarks: [] });
      const held = markup.match(/<li aria-hidden="true"[^>]*>/gu) ?? [];
      expect(held.filter((row) => !row.includes("data-fold")).length).toBe(rows);
      expect(held.some((row) => row.includes("data-fold"))).toBe(folded);
      expect(markup.includes('aria-busy="true"')).toBe(rows > 0);
      expect(markup).not.toContain("Show 6 earlier");
    },
  );

  it("holds no room once what was said is read", () => {
    const markup = html({ count: 5 });
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup.match(/data-zerops-surface="zerops-change-remark"/gu)?.length).toBe(2);
  });

  it("says what could not be read, with Try again, and still takes words", () => {
    const markup = html({
      comments: comments({ kind: "failed", reason: "HQ is not answering right now." }),
      remarks: [],
    });
    expect(markup).toContain("The conversation couldn&#x27;t be read.");
    expect(markup).toContain("HQ is not answering right now.");
    expect(markup).toContain(">Try again</button>");
    expect(markup).toContain("rv-say-box");
  });

  it("sends nobody elsewhere to take part", () => {
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

  async function mount(
    conversation: ChangeDiscussion,
    onAsk: (said: string) => Promise<void>,
    draftKey = `appdev#${String(Math.random())}`,
  ) {
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
          commentable
          comments={conversation}
          draftKey={draftKey}
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
    const value = () => props(box).value as unknown as string;
    return { type, press, key, value, unmount: () => act(async () => root.unmount()) };
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

  it("keeps no draft of words HQ took, so a review opened again cannot post them twice", async () => {
    const read = comments({ kind: "read", comments: [] });
    const first = await mount(read, async () => {}, "appdev#taken");
    await first.type("Ship it");
    await first.press("Comment");
    await first.unmount();
    const again = await mount(read, async () => {}, "appdev#taken");
    expect(again.value()).toBe("");
    await again.unmount();
  });

  it("keeps the draft of words HQ did not take", async () => {
    const refused = comments(
      { kind: "read", comments: [] },
      { say: async () => "You may not comment." },
    );
    const first = await mount(refused, async () => {}, "appdev#refused");
    await first.type("Ship it");
    await first.press("Comment");
    await first.unmount();
    const again = await mount(refused, async () => {}, "appdev#refused");
    expect(again.value()).toBe("Ship it");
    await again.unmount();
  });

  it("drops the draft of words whose answer was lost once HQ shows them as the person's", async () => {
    const lost = comments(
      { kind: "read", comments: [] },
      { say: async () => "HQ could not confirm whether this finished." },
    );
    const first = await mount(lost, async () => {}, "appdev#lost");
    await first.type("Ship it");
    await first.press("Comment");
    await first.unmount();
    const again = await mount({ ...lost, landed: "Ship it" }, async () => {}, "appdev#lost");
    expect(again.value()).toBe("");
    await again.unmount();
  });
});
