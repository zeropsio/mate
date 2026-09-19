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
 * the happy path. The ones below it are the ones that broke something: a
 * change whose checks failed and whose only way forward is the Mate; one that
 * is behind `main` and needs a rebase nobody here can do; one nobody has said
 * anything on; and a Gitea that will not answer at all.
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
          comments={TALKING}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          onBack={() => {}}
          onMerge={() => {}}
          pull={pull()}
          readDetail={undefined}
          remarks={remarks(TALKING.state.kind === "read" ? TALKING.state.comments : [])}
          slug="links"
          trouble={null}
        />
      </State>

      <State
        label="Checks failed"
        note="Merge is refused and the only way forward is the Mate that wrote it."
      >
        <ZeropsChangePane
          comments={SILENT}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          onBack={() => {}}
          onMerge={() => {}}
          pull={pull({ checks: "failing", checkWord: "checks failed", mergeable: false })}
          readDetail={undefined}
          remarks={[]}
          slug="links"
          trouble={null}
        />
      </State>

      <State
        label="Behind main"
        note="Nobody here can rebase it; the button writes the request into Theo's composer."
      >
        <ZeropsChangePane
          comments={SILENT}
          commits={COMMITS}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          onBack={() => {}}
          onMerge={() => {}}
          pull={pull({ mergeable: false })}
          readDetail={undefined}
          remarks={[]}
          slug="links"
          trouble={null}
        />
      </State>

      <State
        label="Merging, and the forge refused the last one"
        note="The verb takes no second press, and the refusal is written rather than swallowed."
      >
        <ZeropsChangePane
          comments={SILENT}
          commits={{ kind: "reading" }}
          mateName={undefined}
          merging
          onAsk={() => {}}
          onBack={() => {}}
          onMerge={() => {}}
          pull={pull({ author: "ales", mateProjectId: undefined })}
          readDetail={undefined}
          remarks={[]}
          slug="links"
          trouble="Gitea refused the merge: the branch is protected."
        />
      </State>

      <State
        label="No Gitea"
        note="Nothing is read, and the box says why rather than sitting dead."
      >
        <ZeropsChangePane
          comments={comments({ kind: "no-gitea" })}
          commits={{ kind: "no-gitea" }}
          mateName="Theo"
          merging={false}
          onAsk={() => {}}
          onBack={() => {}}
          onMerge={() => {}}
          pull={pull()}
          readDetail={undefined}
          remarks={[]}
          slug="links"
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
