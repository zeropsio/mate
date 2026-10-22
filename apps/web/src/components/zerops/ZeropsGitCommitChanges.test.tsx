import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { markupDom } from "../../../test/markupDom";
import { ZeropsGitCommitView } from "./ZeropsGitCommitChanges";
import type { CommitChangesState } from "./ZeropsGitCommitChanges.logic";

const SHA = "9c4e1aa".padEnd(40, "0");
const ENVIRONMENT = EnvironmentId.make("env-1");

/** The commit's page in a state of its read: its links into the Git browser. */
function gitLinks(state: CommitChangesState, appId: string | undefined) {
  const page = markupDom(
    renderToStaticMarkup(
      <ZeropsGitCommitView
        appId={appId}
        commit={{ repository: "appdev", sha: SHA, subject: "Key the cache" }}
        composerDraftTarget={{ environmentId: ENVIRONMENT, threadId: ThreadId.make("t-1") }}
        cwd="/var/www/appdev"
        environmentId={ENVIRONMENT}
        onBack={() => {}}
        onRetry={() => {}}
        state={state}
      />,
    ),
  );
  return [...page.querySelectorAll("a")].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
}

describe("ZeropsGitCommitView: a commit gone from the checkout", () => {
  it.each([
    [
      "a commit no longer in the checkout opens in the Git browser, HQ's copy",
      { kind: "absent" } as const,
      "shop",
      [["Open it in Git", `/git?appId=shop&repo=appdev&rev=${SHA}&view=commit`]],
    ],
    ["a commit the checkout holds offers no other copy", { kind: "empty" } as const, "shop", []],
    [
      "nothing links into the browser where the Mate's application is not known",
      { kind: "absent" } as const,
      undefined,
      [],
    ],
  ])("%s", (_, state, appId, links) => {
    expect(gitLinks(state, appId)).toEqual(links);
  });
});
