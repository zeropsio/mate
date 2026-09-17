import { describe, expect, it } from "vite-plus/test";

import type { GiteaCommitStatus, GiteaPullRequest } from "./giteaClient.ts";
import {
  flowPullRequest,
  mateBotLogin,
  mateProjectOfBranch,
  mateProjectOfLogin,
  pullRequestLineWith,
  pullRequestsByMate,
  pullRequestsFolded,
  releaseRow,
  sidebarPullRequestTitle,
  type FlowPullRequest,
  type FlowRelease,
} from "./projectFlow.ts";

const VERA = "tsXR3xnURPSvsy4zp1EaYA";
const FEN = "9lSt5lFxQ1mQ3v8b7c2d1e";

function pull(overrides: Partial<GiteaPullRequest> = {}): GiteaPullRequest {
  return {
    number: 4,
    title: "Add a due date to each todo",
    state: "open",
    html_url: "https://gitea.example/todo/appdev/pulls/4",
    mergeable: true,
    head: { ref: `mate/mate-${VERA}`, sha: "abc" },
    base: { ref: "main" },
    user: { login: `mate-${VERA}` },
    updated_at: "2026-09-17T18:00:00Z",
    ...overrides,
  };
}

function status(context: string, state: GiteaCommitStatus["state"]): GiteaCommitStatus {
  return { context, state };
}

describe("whose pull request it is", () => {
  it("names the bot after the project, the way the broker does", () => {
    expect(mateBotLogin(VERA)).toBe(`mate-${VERA}`);
  });

  it.each([
    { name: "zcp's branch", ref: `mate/mate-${VERA}`, expected: VERA },
    { name: "a person's branch", ref: "feature/invoices", expected: undefined },
    { name: "a branch named like a Mate's but not one", ref: "mate/feature", expected: undefined },
    { name: "no branch", ref: undefined, expected: undefined },
  ])("reads $name", ({ ref, expected }) => {
    expect(mateProjectOfBranch(ref)).toBe(expected);
  });

  it.each([
    { name: "the bot", login: `mate-${FEN}`, expected: FEN },
    { name: "a person", login: "u-iwbxltjisnogy3r7nj28bg", expected: undefined },
    { name: "nobody", login: undefined, expected: undefined },
  ])("reads $name", ({ login, expected }) => {
    expect(mateProjectOfLogin(login)).toBe(expected);
  });
});

describe("one pull request in the flow", () => {
  it("belongs to the Mate whose branch it is, with the checks as a tone and one word", () => {
    const row = flowPullRequest({
      repository: "appdev",
      pull: pull(),
      checks: [status("ci/test", "success")],
    });
    expect(row).toMatchObject({
      repository: "appdev",
      number: 4,
      kind: "code",
      mateProjectId: VERA,
      checks: "passing",
      checkWord: "Passing",
      mergeable: true,
      baseBranch: "main",
      line: "appdev #4",
    });
  });

  it("belongs to the Mate whose bot opened it when a person renamed the branch", () => {
    const row = flowPullRequest({
      repository: "appdev",
      pull: pull({ head: { ref: "due-dates", sha: "abc" } }),
      checks: [],
    });
    expect(row.mateProjectId).toBe(VERA);
  });

  it("belongs to nobody's Mate when a person opened it from their own branch", () => {
    const row = flowPullRequest({
      repository: "appdev",
      pull: pull({ head: { ref: "feature/x", sha: "abc" }, user: { login: "ada" } }),
      checks: [],
    });
    expect(row.mateProjectId).toBeUndefined();
    expect(row.line).toBe("appdev #4 · ada");
  });

  it("is a recipe change on the group repo, whoever opened it", () => {
    const row = flowPullRequest({ repository: "group", pull: pull(), checks: [] });
    expect(row.kind).toBe("recipe");
    // The row wears the "recipe" tag; the line does not say it twice.
    expect(row.line).toBe("#4");
  });

  it("names the Mate on a row that does not sit under it, and a person once", () => {
    const vera = flowPullRequest({ repository: "appdev", pull: pull(), checks: [] });
    expect(pullRequestLineWith(vera, "Vera")).toBe("appdev #4 · Vera");
    expect(pullRequestLineWith(vera, undefined)).toBe("appdev #4");
    const ada = flowPullRequest({
      repository: "appdev",
      pull: pull({ head: { ref: "feature/x", sha: "abc" }, user: { login: "ada" } }),
      checks: [],
    });
    expect(pullRequestLineWith(ada, "Vera")).toBe("appdev #4 · ada");
  });

  it("offers Merge only where Gitea said the branch is mergeable", () => {
    expect(
      flowPullRequest({ repository: "appdev", pull: pull({ mergeable: false }), checks: [] })
        .mergeable,
    ).toBe(false);
    expect(
      flowPullRequest({ repository: "appdev", pull: pull({ mergeable: undefined }), checks: [] })
        .mergeable,
    ).toBe(false);
  });

  it("does not count the broker's own deploy statuses as checks", () => {
    const row = flowPullRequest({
      repository: "appdev",
      pull: pull(),
      checks: [status("mate/deploy/todo-stage/app", "failure")],
    });
    expect(row.checks).toBe("none");
    expect(row.checkWord).toBeUndefined();
  });

  it("reads as its number and title in a menu row, a person's own naming them", () => {
    const row = flowPullRequest({ repository: "appdev", pull: pull(), checks: [] });
    expect(sidebarPullRequestTitle(row)).toBe("#4 Add a due date to each todo");
    const ada = flowPullRequest({
      repository: "appdev",
      pull: pull({ head: { ref: "feature/x", sha: "abc" }, user: { login: "ada" } }),
      checks: [],
    });
    expect(sidebarPullRequestTitle(ada)).toBe("#4 Add a due date to each todo · ada");
  });
});

describe("the pull requests of each Mate", () => {
  const vera = flowPullRequest({ repository: "appdev", pull: pull(), checks: [] });
  const veraRecipe = flowPullRequest({
    repository: "group",
    pull: pull({ number: 6, title: "Mate: the group's import files" }),
    checks: [],
  });
  const fen = flowPullRequest({
    repository: "appdev",
    pull: pull({
      number: 5,
      head: { ref: `mate/mate-${FEN}`, sha: "def" },
      user: { login: `mate-${FEN}` },
      updated_at: "2026-09-17T19:00:00Z",
    }),
    checks: [],
  });
  const ada = flowPullRequest({
    repository: "appdev",
    pull: pull({ number: 7, head: { ref: "feature/x", sha: "fff" }, user: { login: "ada" } }),
    checks: [],
  });

  it("puts each Mate's under it, newest first, and the rest after the Mates", () => {
    const older = flowPullRequest({
      repository: "appdev",
      pull: pull({ number: 3, updated_at: "2026-09-17T12:00:00Z" }),
      checks: [],
    });
    const grouped = pullRequestsByMate([older, ada, fen, vera, veraRecipe], [VERA, FEN]);
    // #4 and #6 moved at the same moment; the higher number is the newer one.
    expect(grouped.byMate.get(VERA)?.map((entry) => entry.number)).toEqual([6, 4, 3]);
    expect(grouped.byMate.get(FEN)?.map((entry) => entry.number)).toEqual([5]);
    expect(grouped.others.map((entry) => entry.number)).toEqual([7]);
  });

  it("lists a pull request of a Mate the caller does not know among the rest", () => {
    const grouped = pullRequestsByMate([vera], [FEN]);
    expect(grouped.byMate.get(FEN)).toEqual([]);
    expect(grouped.others.map((entry) => entry.number)).toEqual([4]);
  });

  it("folds a Mate's pull requests only once there are more than three", () => {
    expect(pullRequestsFolded(0)).toBe(false);
    expect(pullRequestsFolded(3)).toBe(false);
    expect(pullRequestsFolded(4)).toBe(true);
  });
});

describe("a release's row", () => {
  const newest: FlowRelease = {
    tag: "v1.3.0",
    verdict: "approved",
    detail: undefined,
    line: "api 3f9c1b2",
  };
  const earlier: FlowRelease = { ...newest, tag: "v1.2.0", line: "api 1111111" };
  const refused: FlowRelease = {
    tag: "v1.1.0",
    verdict: "refused",
    detail: "ada is not a releaser",
    line: "api 2222222",
  };
  const judged: FlowRelease = { ...newest, tag: "v1.0.0", verdict: "pending", line: "api 3333333" };

  it.each([
    { release: newest, index: 0, expected: false, why: "the newest is what production runs" },
    {
      release: earlier,
      index: 1,
      expected: true,
      why: "an earlier approved one can be gone back to",
    },
    { release: refused, index: 2, expected: false, why: "a refused release never deployed" },
    { release: judged, index: 3, expected: false, why: "a release still being judged" },
  ])("offers a roll-back: $expected — $why", ({ release, index, expected }) => {
    expect(releaseRow(release, index).rollBack).toBe(expected);
  });

  it("says the broker's word beside the dot and its refusal as the line", () => {
    const row = releaseRow(refused, 2);
    expect(row.word).toBe("Refused");
    expect(row.line).toBe("ada is not a releaser");
    expect(releaseRow(newest, 0).line).toBe("api 3f9c1b2");
  });
});

describe("types", () => {
  it("carries what every surface needs and nothing a surface decides", () => {
    const row: FlowPullRequest = flowPullRequest({
      repository: "appdev",
      pull: pull(),
      checks: [],
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        "author",
        "baseBranch",
        "checkWord",
        "checks",
        "headSha",
        "kind",
        "line",
        "mateProjectId",
        "mergeable",
        "number",
        "repository",
        "title",
        "updatedAt",
        "url",
      ].sort(),
    );
  });
});
