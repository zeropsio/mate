import { describe, expect, it } from "vite-plus/test";

import type { VcsStatusResult } from "@t3tools/contracts";

import type { DiffPanelSelection } from "../diffPanelStore";
import {
  diffChoiceCount,
  diffChoices,
  diffRepositories,
  shownDiff,
  type DiffRepositoryRead,
  type DiffRepositoryStatus,
} from "./DiffPanel.logic";

/** What git says of a checkout, as the Git page reads it. */
function status(
  input: {
    readonly changed?: number;
    readonly onMain?: boolean;
    readonly pushed?: boolean;
    readonly ahead?: number;
    readonly aheadOfMain?: number;
    readonly isRepo?: boolean;
  } = {},
): VcsStatusResult {
  const files = Array.from({ length: input.changed ?? 0 }, (_, index) => ({
    path: `file-${index}.ts`,
    insertions: 1,
    deletions: 0,
  }));
  return {
    isRepo: input.isRepo ?? true,
    hasPrimaryRemote: true,
    isDefaultRef: input.onMain ?? false,
    refName: input.onMain ? "main" : "feature",
    hasWorkingTreeChanges: files.length > 0,
    workingTree: { files, insertions: files.length, deletions: 0 },
    hasUpstream: input.pushed ?? true,
    aheadCount: input.ahead ?? 0,
    behindCount: 0,
    ...(input.aheadOfMain === undefined ? {} : { aheadOfDefaultCount: input.aheadOfMain }),
    pr: null,
  };
}

const read = (name: string, repositoryStatus: DiffRepositoryStatus): DiffRepositoryRead => ({
  repository: { name, label: name, cwd: `/var/www/${name}` },
  status: repositoryStatus,
});

const OPENED: DiffPanelSelection = { kind: "unstaged" };

describe("diffChoices", () => {
  it.each([
    {
      name: "a checkout on a branch offers its files not committed and its commits not on main",
      status: status({ changed: 2, aheadOfMain: 3 }),
      shows: [
        ["Not committed", "2 files"],
        ["Not on main", "3 commits"],
      ],
    },
    {
      name: "a checkout on main offers its commits not pushed",
      status: status({ onMain: true, changed: 1, ahead: 1 }),
      shows: [
        ["Not committed", "1 file"],
        ["Not pushed", "1 commit"],
      ],
    },
    {
      name: "a checkout on main never pushed counts no commits it cannot compare",
      status: status({ onMain: true, pushed: false, ahead: 0 }),
      shows: [
        ["Not committed", "0 files"],
        ["Not pushed", null],
      ],
    },
    {
      name: "a checkout git has not answered for counts nothing yet",
      status: "reading" as const,
      shows: [
        ["Not committed", null],
        ["Not on main", null],
      ],
    },
    {
      name: "a folder that is no repository offers nothing",
      status: status({ isRepo: false }),
      shows: [],
    },
  ])("$name", ({ status: repositoryStatus, shows }) => {
    expect(
      diffChoices([read("apidev", repositoryStatus)]).map((choice) => [
        choice.label,
        diffChoiceCount(choice),
      ]),
    ).toEqual(shows);
  });

  it("says what each kind of nothing is, in the repository's name", () => {
    const [notCommitted, notOnMain] = diffChoices([read("apidev", status())]);
    const [, notPushed] = diffChoices([read("apidev", status({ onMain: true }))]);
    const [, neverPushed] = diffChoices([read("apidev", status({ onMain: true, pushed: false }))]);
    expect(
      [notCommitted, notOnMain, notPushed, neverPushed].map((choice) => choice?.nothing),
    ).toEqual([
      "Everything in apidev is committed.",
      "Nothing in apidev is outside main.",
      "Everything in apidev is pushed.",
      "apidev has never been pushed: there is nothing to compare it with.",
    ]);
  });
});

describe("shownDiff", () => {
  it.each<{
    readonly name: string;
    readonly reads: ReadonlyArray<DiffRepositoryRead> | null;
    readonly selection: DiffPanelSelection;
    readonly shows: string;
  }>([
    {
      name: "while the repositories are still read, Diff reads git",
      reads: null,
      selection: OPENED,
      shows: "reading",
    },
    {
      name: "while one repository's status is still read, Diff picks none yet",
      reads: [read("apidev", status({ changed: 1 })), read("appdev", "reading")],
      selection: OPENED,
      shows: "reading",
    },
    {
      name: "opened, Diff shows the first repository with changes not committed",
      reads: [read("apidev", status({ aheadOfMain: 2 })), read("appdev", status({ changed: 1 }))],
      selection: OPENED,
      shows: "appdev:unstaged",
    },
    {
      name: "with everything committed, Diff shows the first repository's commits not on main",
      reads: [read("apidev", status()), read("appdev", status({ aheadOfMain: 2 }))],
      selection: OPENED,
      shows: "appdev:branch",
    },
    {
      name: "on main, commits not pushed are what Diff shows",
      reads: [read("apidev", status({ onMain: true, ahead: 1 }))],
      selection: OPENED,
      shows: "apidev:branch",
    },
    {
      name: "a person's choice stands, even of nothing",
      reads: [read("apidev", status({ changed: 1 })), read("appdev", status())],
      selection: { kind: "branch", baseRef: null, repository: "appdev" },
      shows: "appdev:branch",
    },
    {
      name: "a person's choice stands while its repository's status is still read",
      reads: [read("apidev", "reading"), read("appdev", "reading")],
      selection: { kind: "unstaged", repository: "appdev" },
      shows: "appdev:unstaged",
    },
    {
      name: "a choice whose repository is gone gives way to what is not on main",
      reads: [read("apidev", status({ changed: 1 }))],
      selection: { kind: "branch", baseRef: null, repository: "appdev" },
      shows: "apidev:unstaged",
    },
    {
      name: "a repository never pushed is shown rather than called all clear",
      reads: [read("apidev", status({ onMain: true, pushed: false }))],
      selection: OPENED,
      shows: "apidev:branch",
    },
    {
      name: "with nothing outside main in any repository, Diff says so",
      reads: [read("apidev", status({ onMain: true })), read("appdev", status({ aheadOfMain: 0 }))],
      selection: OPENED,
      shows: "nothing-outside-main",
    },
    {
      name: "with no repository, Diff says there is no code here",
      reads: [read("var/www", status({ isRepo: false }))],
      selection: OPENED,
      shows: "no-code",
    },
    {
      name: "a Mate with no checkouts has no code here",
      reads: [],
      selection: OPENED,
      shows: "no-code",
    },
  ])("$name", ({ reads, selection, shows }) => {
    const shown = shownDiff(reads, selection);
    expect(
      shown.kind === "choice"
        ? `${shown.choice.repository.name}:${shown.choice.scope}`
        : shown.kind,
    ).toBe(shows);
  });
});

describe("diffRepositories", () => {
  const LEASE = { alias: "webpool-3", pool: "webpool", branch: "feat-x" } as const;

  it("a thread bound to a lease diffs that lease's repository, named by its pool and branch", () => {
    expect(
      diffRepositories({
        checkouts: ["webpool-3"],
        cwd: "/var/www",
        crewmate: null,
        leases: [LEASE],
      }),
    ).toEqual([{ name: "webpool-3", label: "webpool · feat-x", cwd: "/var/www/webpool-3" }]);
  });

  it("a thread bound to no lease diffs the Mate's checkouts by their hostnames", () => {
    expect(
      diffRepositories({ checkouts: ["appdev"], cwd: "/var/www", crewmate: null, leases: [] }),
    ).toEqual([{ name: "appdev", label: "appdev", cwd: "/var/www/appdev" }]);
  });

  it("a thread bound to a lease of a branch held on several pools diffs every lease of it, each named by its pool and branch", () => {
    const hq = { alias: "hqpool-2", pool: "hqpool", branch: "feat-x" } as const;
    expect(
      diffRepositories({
        checkouts: ["webpool-3", "hqpool-2"],
        cwd: "/var/www",
        crewmate: null,
        leases: [LEASE, hq],
      }),
    ).toEqual([
      { name: "webpool-3", label: "webpool · feat-x", cwd: "/var/www/webpool-3" },
      { name: "hqpool-2", label: "hqpool · feat-x", cwd: "/var/www/hqpool-2" },
    ]);
  });
});

describe("two workspaces of one pool and branch", () => {
  // zcp holds one lease per repository, branch and pool: two repositories on one pool's branch are
  // two leases that read alike.
  const web = { alias: "webpool-3", pool: "webpool", branch: "feat-x" } as const;
  const docs = { alias: "webpool-4", pool: "webpool", branch: "feat-x" } as const;

  it("are two repositories in Diff, each kept by its own choice", () => {
    const repositories =
      diffRepositories({
        checkouts: ["webpool-3", "webpool-4"],
        cwd: "/var/www",
        crewmate: null,
        leases: [web, docs],
      }) ?? [];
    expect(new Set(repositories.map(({ name }) => name)).size).toBe(2);
    const reads = repositories.map((repository, index) => ({
      repository,
      status: status({ changed: index }),
    }));
    // The person chose the first, which has nothing uncommitted; the other has a file.
    const chosen = repositories[0]?.name ?? "";
    const shown = shownDiff(reads, { kind: "unstaged", repository: chosen });
    expect(shown.kind === "choice" ? shown.choice.repository.cwd : shown.kind).toBe(
      "/var/www/webpool-3",
    );
  });
});
