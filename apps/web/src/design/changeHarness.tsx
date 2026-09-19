/**
 * A change's page, in the states it really reaches.
 *
 * Served by the dev server at `/design-change.html`. It renders the real pane
 * with made-up data and no session, so there is no door to get through and
 * nothing live to disturb — the page's own hooks live one level up
 * (`ZeropsChangeDetailPage`), which is why the pane takes its reads as props.
 *
 * ## The states are the point
 *
 * A change that merges cleanly, with two people and a Mate talking on it, is
 * the happy path. The rest are the ones a real account cannot be waited into:
 * checks that failed and blocked the merge, checks that failed and did not,
 * checks still running, a change nothing ever ran on, one behind `main` that
 * needs a rebase nobody here can do, a forge that refused the last merge, and
 * a Gitea that will not answer at all. The pair in the middle is why the
 * verdict exists — they look identical on a definition list and are not.
 *
 * Fixtures only. Nothing here ships in the app bundle — `design-change.html`
 * is not `index.html`, and no route imports this module.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  changeRemarks,
  type ChangeRemark,
  type FlowPullRequest,
  type GiteaIssueComment,
} from "@t3tools/client-runtime/zerops";

import { ZeropsChangePane } from "~/components/zerops/ZeropsGroupDetail";
import type { ZeropsChangeComments } from "~/zerops/useZeropsChangeComments";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";

import "../index.css";

/** Where these panes sit, as the harness pretends: the chat, then the project. */
const NAMES = {
  mateNames: new Map([["p-theo", "Theo"]]),
  groupName: "Links",
};

const CRUMBS = [
  { label: "Projects", onClick: () => {} },
  { label: "Shop", onClick: () => {} },
];

const MATE_NAMES = new Map([
  ["p-theo", "Theo"],
  ["p-wren", "Wren"],
]);

function said(id: number, author: string, body: string, minutesAgo: number): GiteaIssueComment {
  return {
    id,
    author,
    avatarUrl: undefined,
    body,
    at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

function remarks(comments: ReadonlyArray<GiteaIssueComment>): ReadonlyArray<ChangeRemark> {
  return changeRemarks({ comments, mateNames: MATE_NAMES, me: "ales" });
}

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "appdev",
    number: 5,
    title: "Cache the link previews so the list stops flickering",
    author: "Theo",
    mateProjectId: "p-theo",
    baseBranch: "main",
    headBranch: "mate/p-theo",
    headSha: "b21d904cb21d904cb21d904cb21d904cb21d904c",
    url: "https://gitea.example/links/appdev/pulls/5",
    mergeable: true,
    merged: false,
    checks: "passing",
    checkWord: "checks passed",
    updatedAt: new Date().toISOString(),
    kind: "code",
    ...over,
  } as FlowPullRequest;
}

const COMMITS: ZeropsCommitsState = {
  kind: "read",
  commits: [
    {
      sha: "b21d904cb21d904cb21d904cb21d904cb21d904c",
      subject: "Key the preview cache on locale",
      author: "Theo",
      at: new Date(Date.now() - 40 * 60_000).toISOString(),
    },
    {
      sha: "5c3ea18b5c3ea18b5c3ea18b5c3ea18b5c3ea18b",
      subject: "Cache the link previews",
      author: "Theo",
      at: new Date(Date.now() - 90 * 60_000).toISOString(),
    },
  ],
  releases: new Map(),
};

function comments(state: ZeropsChangeComments["state"]): ZeropsChangeComments {
  return { state, say: async () => null, saying: false };
}

const TALKING = comments({
  kind: "read",
  comments: [
    said(1, "ales", "The cache key ignores the locale — a Czech reader gets the English one.", 95),
    said(2, "mate-p-theo", "Good catch. Keying on locale now, and the tests cover both.", 41),
    said(3, "wren", "Reads fine to me. One nit: the TTL could be a constant.", 12),
  ],
});

const SILENT = comments({ kind: "read", comments: [] });

/** One state, named, with room around it. */
function State({
  label,
  note,
  children,
}: {
  readonly label: string;
  readonly note: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-2">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <p className="text-xs text-muted-foreground/78">{note}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

function Harness() {
  return (
    <div className="flex flex-col gap-10 bg-background p-6">
      <State
        label="Merges cleanly, three people talking"
        note="The verb is live; the conversation carries a person, a Mate and a reviewer."
      >
        <ZeropsChangePane
          age="2h"
          comments={TALKING}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull()}
          readDetail={undefined}
          remarks={remarks(TALKING.state.kind === "read" ? TALKING.state.comments : [])}
          trouble={null}
        />
      </State>

      <State
        label="Checks failed"
        note="Merge is refused and the only way forward is the Mate that wrote it."
      >
        <ZeropsChangePane
          age="14m"
          comments={SILENT}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull({ checks: "failing", checkWord: "checks failed", mergeable: false })}
          readDetail={undefined}
          remarks={[]}
          trouble={null}
        />
      </State>

      <State
        label="Checks failed, and the forge takes it anyway"
        note="Nothing required the checks, so Merge is live — the page says that rather than leaving a lit button unexplained."
      >
        <ZeropsChangePane
          age="1h"
          comments={SILENT}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull({ checks: "failing", checkWord: "checks failed" })}
          readDetail={undefined}
          remarks={[]}
          trouble={null}
        />
      </State>

      <State
        label="Checks still running"
        note="Nothing is waiting on a person: there is no verb to hand it over with."
      >
        <ZeropsChangePane
          age="4m"
          comments={SILENT}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull({ checks: "pending", checkWord: "checks running", mergeable: false })}
          readDetail={undefined}
          remarks={[]}
          trouble={null}
        />
      </State>

      <State
        label="Nothing ever ran"
        note="No signal is not a good signal, so it is grey rather than green."
      >
        <ZeropsChangePane
          age="6d"
          comments={SILENT}
          commits={COMMITS}
          mateName={undefined}
          merging={false}
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull({
            author: "ales",
            mateProjectId: undefined,
            checks: "none",
            checkWord: undefined,
          })}
          readDetail={undefined}
          remarks={[]}
          trouble={null}
        />
      </State>

      <State
        label="Behind main"
        note="Nobody here can rebase it; the button writes the request into Theo's composer."
      >
        <ZeropsChangePane
          age="3d"
          comments={SILENT}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull({ mergeable: false })}
          readDetail={undefined}
          remarks={[]}
          trouble={null}
        />
      </State>

      <State
        label="Merging, and the forge refused the last one"
        note="The verb takes no second press, and the refusal is written rather than swallowed."
      >
        <ZeropsChangePane
          age={undefined}
          comments={SILENT}
          commits={{ kind: "reading" }}
          mateName={undefined}
          merging
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull({ author: "ales", mateProjectId: undefined })}
          readDetail={undefined}
          remarks={[]}
          trouble="Gitea refused the merge: the branch is protected."
        />
      </State>

      <State
        label="No Gitea"
        note="Nothing is read, and the box says why rather than sitting dead."
      >
        <ZeropsChangePane
          age="5h"
          comments={comments({ kind: "no-gitea" })}
          commits={{ kind: "no-gitea" }}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          crumbs={CRUMBS}
          names={NAMES}
          onMerge={() => {}}
          pull={pull()}
          readDetail={undefined}
          remarks={[]}
          trouble={null}
        />
      </State>
    </div>
  );
}

document.documentElement.classList.toggle(
  "dark",
  new URLSearchParams(location.search).get("theme") === "dark",
);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
