import { RegistryContext } from "@effect/atom-react";
import type { ChangeCommitsResponse } from "@t3tools/shared/hqChanges";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { reviewAccount } from "~/zerops/__fixtures__/reviewAccount";
import { AccountDataContext } from "~/zerops/ZeropsAccountData";
import { ZeropsGitBlockCommits } from "./ZeropsGitBlockCommits";

afterEach(() => vi.unstubAllGlobals());

it("Change history waits for an explicit opening and publishes commits that arrive later.", async () => {
  const window = new Window();
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const review = vi.fn(async () => {
    throw new Error("History must not load file patches.");
  });
  let answer: ((value: ChangeCommitsResponse) => void) | undefined;
  const commits = vi.fn(
    () =>
      new Promise<ChangeCommitsResponse>((resolve) => {
        answer = resolve;
      }),
  );
  const account = reviewAccount(review, undefined, commits);
  const container = document.createElement("div");
  const root = createRoot(container);
  const head = "c".repeat(40);
  const main = "a".repeat(40);
  const render = (number: number) => (
    <RegistryContext.Provider value={account.registry}>
      <AccountDataContext.Provider value={account.data}>
        <ZeropsGitBlockCommits appId="g1" repository="api" change={{ number, head }} main={main} />
      </AccountDataContext.Provider>
    </RegistryContext.Provider>
  );
  try {
    await act(async () => root.render(render(12)));
    expect(container.textContent).toBe("History");
    expect(commits).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")!.click());
    expect(commits).toHaveBeenCalledExactlyOnceWith({
      link: { appId: "g1", repo: "api", number: 12 },
      snapshot: { expectedHead: head, expectedMain: main },
    });
    expect(container.querySelectorAll("li")).toHaveLength(0);
    await act(async () =>
      answer!({
        change: { head } as ChangeCommitsResponse["change"],
        mainHead: main,
        commits: [
          { sha: head, subject: "Answer /status", authorName: "Vera", at: "2026-10-02T11:00:00Z" },
        ],
        commitsTruncated: false,
      }),
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector("li")!.textContent).toContain("Answer /status");
    expect(review).not.toHaveBeenCalled();
    await act(async () => root.render(render(13)));
    expect(container.textContent).toBe("History");
    expect(commits).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});
