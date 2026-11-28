import { expect, it } from "vite-plus/test";

import { yourAppHas, type YourAppChange } from "./yourAppHas.ts";

const MATE = "mate-1";
const OLDER_HEAD = "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEWER_HEAD = "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const API_HEAD = "3333333ccccccccccccccccccccccccccccccccc";
const OTHER_MATE_HEAD = "4444444ddddddddddddddddddddddddddddddddd";
const OUTSIDE_HEAD = "5555555eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const NOBODY_HEAD = "6666666fffffffffffffffffffffffffffffffff";

const change = (
  title: string,
  mergedAt: string,
  headSha: string,
  more: Partial<YourAppChange> = {},
): YourAppChange => ({
  kind: "code",
  mateProjectId: MATE,
  repository: "web",
  title,
  mergedAt,
  headSha,
  ...more,
});

const merged: ReadonlyArray<YourAppChange> = [
  change("Colours", "2026-11-27T09:00:00Z", NEWER_HEAD),
  change("Guestbook", "2026-11-27T08:00:00Z", OLDER_HEAD),
  change("Login", "2026-11-27T08:30:00Z", API_HEAD, { repository: "api" }),
  change("Theirs", "2026-11-27T10:00:00Z", OTHER_MATE_HEAD, { mateProjectId: "mate-2" }),
  change("Outside", "2026-11-27T10:30:00Z", OUTSIDE_HEAD, { landedOutside: true }),
];

// witness: packages/client-runtime/src/zerops/yourAppHas.ts | if (input.version !== undefined) { → if (input.version?.commit !== undefined) {
it("ZV+1: Your app says the version its stage runs only where the Mate's envelope names a version built from the head of one of that Mate's own merged changes in that stage's repository, with that change; a version of another commit or of none says nothing, and an unread version keeps the newest-merge answer without a version; breaks: Sites shows a version for a deploy nobody added, another Mate's change or a Review build, or names the newest change while the stage runs an older one", () => {
  const at = "2026-11-27T11:00:00Z";
  const cases = [
    // One stage: every change of the Mate is its.
    {
      name: "one stage, version not read: the newest merge, no version",
      repository: undefined,
      deployedAt: "2026-11-27T08:45:00Z",
      version: undefined,
      want: { title: "Colours", at: "2026-11-27T09:00:00Z", version: undefined },
    },
    {
      name: "one stage, version not read, a deploy after the newest merge: nothing",
      repository: undefined,
      deployedAt: "2026-11-27T09:30:00Z",
      version: undefined,
      want: undefined,
    },
    {
      name: "one stage, version of an older own change's head: that change, with the version",
      repository: undefined,
      deployedAt: "2026-11-27T09:30:00Z",
      version: { commit: OLDER_HEAD, at },
      want: { title: "Guestbook", at: "2026-11-27T08:00:00Z", version: "1111111" },
    },
    {
      name: "one stage, version of the newest own change's head, written in capitals",
      repository: undefined,
      deployedAt: undefined,
      version: { commit: NEWER_HEAD.toUpperCase(), at },
      want: { title: "Colours", at: "2026-11-27T09:00:00Z", version: "2222222" },
    },
    {
      name: "one stage, version of another Mate's change: nothing",
      repository: undefined,
      deployedAt: "2026-11-27T08:45:00Z",
      version: { commit: OTHER_MATE_HEAD, at },
      want: undefined,
    },
    {
      name: "one stage, version of a change landed outside Mate: nothing",
      repository: undefined,
      deployedAt: "2026-11-27T08:45:00Z",
      version: { commit: OUTSIDE_HEAD, at },
      want: undefined,
    },
    {
      name: "one stage, version of a commit no change has: nothing",
      repository: undefined,
      deployedAt: "2026-11-27T08:45:00Z",
      version: { commit: NOBODY_HEAD, at },
      want: undefined,
    },
    {
      name: "one stage, version without a commit: nothing",
      repository: undefined,
      deployedAt: "2026-11-27T08:45:00Z",
      version: { commit: undefined, at },
      want: undefined,
    },
    // Several stages: each goes by its repository's changes only.
    {
      name: "several repositories, version not read: that repository's newest merge",
      repository: "api",
      deployedAt: "2026-11-27T08:20:00Z",
      version: undefined,
      want: { title: "Login", at: "2026-11-27T08:30:00Z", version: undefined },
    },
    {
      name: "several repositories, version of that repository's change",
      repository: "api",
      deployedAt: "2026-11-27T09:30:00Z",
      version: { commit: API_HEAD, at },
      want: { title: "Login", at: "2026-11-27T08:30:00Z", version: "3333333" },
    },
    {
      name: "several repositories, version of the other repository's change: nothing",
      repository: "api",
      deployedAt: "2026-11-27T08:40:00Z",
      version: { commit: NEWER_HEAD, at },
      want: undefined,
    },
  ];
  for (const row of cases)
    expect(
      yourAppHas({
        mateProjectId: MATE,
        repository: row.repository,
        merged,
        deployedAt: row.deployedAt,
        version: row.version,
      }),
      row.name,
    ).toEqual(row.want);
});
