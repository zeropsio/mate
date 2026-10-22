// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { GitRepoAt } from "../gitBrowser/GitBrowserLink";
import { ProjectHistoryView } from "./ProjectHistory";
import type { HistoryRelease } from "./projectHistory.logic";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const FIX = "f1".padEnd(40, "0");
const BUMP = "b2".padEnd(40, "0");
const RELEASE: HistoryRelease = {
  tag: "v1.0.4",
  taggedAt: "2026-10-20T09:00:00Z",
  state: "live",
  backTo: undefined,
  changes: [],
  outside: [
    { sha: FIX, subject: "Fix the VAT rounding" },
    { sha: BUMP, subject: "Bump the lockfile" },
  ],
};

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});

/** The History with its release and its commits outside Mate opened: their links into the browser. */
async function outsideLinks(repo: GitRepoAt | undefined) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ProjectHistoryView
        face={() => null}
        mateName={() => undefined}
        onOpen={() => {}}
        releases={[RELEASE]}
        repo={repo}
      />,
    ),
  );
  const press = (words: string) =>
    act(async () =>
      [...host!.querySelectorAll("button")]
        .find((button) => button.textContent?.includes(words))!
        .click(),
    );
  await press("v1.0.4");
  await press("2 commits outside Mate");
  expect(host.textContent).toContain("Fix the VAT rounding");
  return [...host.querySelectorAll("a")].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
}

describe("ProjectHistoryView: commits outside Mate in the Git browser", () => {
  it("each commit outside Mate opens its page in the Git browser", async () => {
    expect(await outsideLinks({ appId: "shop", repo: "app" })).toEqual([
      ["Fix the VAT rounding", `/git?appId=shop&repo=app&rev=${FIX}&view=commit`],
      ["Bump the lockfile", `/git?appId=shop&repo=app&rev=${BUMP}&view=commit`],
    ]);
  });

  it("links nothing where the project's repository is not known", async () => {
    expect(await outsideLinks(undefined)).toEqual([]);
  });
});
