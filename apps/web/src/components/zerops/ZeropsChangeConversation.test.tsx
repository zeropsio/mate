import { changeRemarks, type ChangeRemark } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type {
  ZeropsChangeComments,
  ZeropsChangeCommentsState,
} from "~/zerops/useZeropsChangeComments";

import { ZeropsChangeConversation } from "./ZeropsChangeConversation";

const CHANGE = {
  mateProjectId: "p-abc",
  number: 4,
  repository: "appdev",
  title: "Cache the link previews",
};

function remarks(): ReadonlyArray<ChangeRemark> {
  return changeRemarks({
    comments: [
      {
        id: 1,
        author: "ales",
        avatarUrl: undefined,
        body: "The cache key ignores the locale.",
        at: "2026-09-19T09:00:00Z",
      },
      {
        id: 2,
        author: "mate-p-abc",
        avatarUrl: undefined,
        body: "Fixed — it keys on locale now.",
        at: "2026-09-19T09:20:00Z",
      },
    ],
    mateNames: new Map([["p-abc", "Theo"]]),
    me: "ales",
  });
}

function comments(state: ZeropsChangeCommentsState): ZeropsChangeComments {
  return { state, say: async () => null, saying: false };
}

function render(props: Partial<Parameters<typeof ZeropsChangeConversation>[0]> = {}): string {
  return renderToStaticMarkup(
    <ZeropsChangeConversation
      change={CHANGE}
      comments={comments({ kind: "read", comments: [] })}
      mateName="Theo"
      onAsk={() => {}}
      remarks={remarks()}
      {...props}
    />,
  );
}

describe("a change's conversation", () => {
  it("shows what was said, so the page is not a fact sheet", () => {
    const html = render();
    expect(html).toContain("The cache key ignores the locale.");
    expect(html).toContain("Fixed — it keys on locale now.");
  });

  it("names the Mate that spoke rather than showing its bot login", () => {
    const html = render();
    expect(html).toContain("Theo");
    expect(html).not.toContain("mate-p-abc");
  });

  it("offers both verbs: saying it, and handing it to the Mate", () => {
    const html = render();
    expect(html).toContain("Comment");
    expect(html).toContain("Ask Theo");
  });

  it("says what the hand-over does before it is pressed", () => {
    // An empty box hands the whole change over; a written one hands the words.
    expect(render()).toContain("Asking with an empty box hands the whole change over.");
  });

  it("falls back to a nameless Mate rather than a blank verb", () => {
    expect(render({ mateName: undefined })).toContain("Ask the Mate");
  });

  it("draws every remark on the same spine the menu and the history use", () => {
    const html = render();
    expect(html).toContain("var(--zerops-rail)");
    expect(html.match(/data-zerops-surface="zerops-change-remark"/gu)?.length).toBe(2);
  });

  it("says nothing twice over when nobody has spoken: the heading counts it and the box invites", () => {
    const html = render({ remarks: [] });
    expect(html).not.toContain("zerops-change-remark");
    // The box is still there, so an empty conversation is an invitation.
    expect(html).toContain("Say something");
  });

  it("asks for a sign-in rather than blaming the change when Gitea is unreachable", () => {
    const html = render({ comments: comments({ kind: "no-gitea" }), remarks: [] });
    expect(html).toContain("Sign in to Gitea to read what was said here.");
  });

  it("answers a refusal with its reason, having no conversation to fall back on", () => {
    const html = render({
      comments: comments({ kind: "failed", reason: "Gitea said 403." }),
      remarks: [],
    });
    expect(html).toContain("Gitea said 403.");
  });

  it("never sends anybody to Gitea to take part", () => {
    expect(render()).not.toContain("<a ");
  });
});
