import { describe, expect, it } from "vite-plus/test";

import type { GiteaCommitStatus } from "./giteaClient.ts";
import {
  compareForRelease,
  isReleaseTag,
  newestReleaseTag,
  readReleaseMessage,
  releaseEntriesFromStage,
  releaseGate,
  releaseMessage,
  releaseOffer,
  releaseStatusContext,
  releaseVerdict,
  releaseWord,
  RELEASE_NOTHING_CHANGED,
  RELEASE_NOTHING_TO_LIST,
  RELEASE_NOT_A_RELEASER,
  rollbackTo,
  suggestReleaseTags,
} from "./release.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

describe("the tag's message", () => {
  it("is one line per service, in service order", () => {
    expect(
      releaseMessage([
        { service: "web", commit: WEB },
        { service: "api", commit: API },
      ]),
    ).toBe(`api ${API}\nweb ${WEB}`);
  });

  it("lower-cases a sha, so it compares equal to a version's name", () => {
    expect(releaseMessage([{ service: "api", commit: API.toUpperCase() }])).toBe(`api ${API}`);
  });

  it("drops anything that is not a full sha rather than writing a tag the broker refuses", () => {
    expect(releaseMessage([{ service: "api", commit: "3f9c1b2" }])).toBe("");
  });

  it.each([
    { name: "two services", message: `api ${API}\nweb ${WEB}`, expected: 2 },
    { name: "blank lines between them", message: `api ${API}\n\n\nweb ${WEB}\n`, expected: 2 },
    {
      name: "a short sha, which makes the whole tag unreadable",
      message: `api 3f9c1b2`,
      expected: 0,
    },
    { name: "a third word", message: `api ${API} extra`, expected: 0 },
    { name: "a line with no sha", message: `api`, expected: 0 },
    { name: "nothing at all", message: "", expected: 0 },
  ])("reads $name", ({ message, expected }) => {
    expect(readReleaseMessage(message)).toHaveLength(expected);
  });

  it("round-trips: what it writes is what it reads", () => {
    const entries = [
      { service: "api", commit: API },
      { service: "web", commit: WEB },
    ];
    expect(readReleaseMessage(releaseMessage(entries))).toEqual(entries);
  });
});

describe("what to call the next release", () => {
  it.each([
    { name: "a group that has never released", tags: [], patch: "v0.1.0", minor: "v0.1.0" },
    { name: "one release", tags: ["v1.2.0"], patch: "v1.2.1", minor: "v1.3.0" },
    {
      name: "the newest by version, not by name",
      tags: ["v1.9.0", "v1.10.0", "v1.2.0"],
      patch: "v1.10.1",
      minor: "v1.11.0",
    },
    {
      name: "tags that are not ours, ignored",
      tags: ["release-3", "v2.0.0", "nightly"],
      patch: "v2.0.1",
      minor: "v2.1.0",
    },
  ])("suggests, for $name", ({ tags, patch, minor }) => {
    expect(suggestReleaseTags(tags)).toEqual({ patch, minor });
  });

  it.each([
    { tag: "v1.2.3", expected: true },
    { tag: "v1.2", expected: false },
    { tag: "1.2.3", expected: false },
    { tag: "v1.2.3-rc1", expected: false },
  ])("recognises $tag as ours: $expected", ({ tag, expected }) => {
    expect(isReleaseTag(tag)).toBe(expected);
  });

  it("has no newest tag among tags that are none of ours", () => {
    expect(newestReleaseTag(["nightly", "release-3"])).toBeUndefined();
  });
});

describe("what Release shows before it is pressed", () => {
  it("says, per service, what the stage runs against what production runs", () => {
    expect(
      compareForRelease({
        stage: new Map([
          ["api", API],
          ["web", WEB],
        ]),
        production: new Map([
          ["api", OLD],
          ["web", WEB],
        ]),
      }),
    ).toEqual([
      { service: "api", stage: "3f9c1b2", production: "1111111", changed: true },
      { service: "web", stage: "77ab0e1", production: "77ab0e1", changed: false },
    ]);
  });

  it("names a service production has but the stage has not deployed to", () => {
    expect(compareForRelease({ stage: new Map(), production: new Map([["api", API]]) })).toEqual([
      { service: "api", stage: undefined, production: "3f9c1b2", changed: false },
    ]);
  });

  it("lists every service the stage has a commit for, changed or not", () => {
    expect(
      releaseEntriesFromStage(
        new Map([
          ["api", API],
          ["web", WEB],
        ]),
      ),
    ).toHaveLength(2);
  });

  it("lists nothing for a version name that is not a commit", () => {
    expect(releaseEntriesFromStage(new Map([["api", "hotfix"]]))).toEqual([]);
  });
});

describe("the app's own gate", () => {
  const entries = [{ service: "api", commit: API }];

  it.each([
    { name: "a releaser with something to release", mayRelease: true, entries, allowed: true },
    {
      name: "somebody who is not in the release right",
      mayRelease: false,
      entries,
      allowed: false,
      reason: RELEASE_NOT_A_RELEASER,
    },
    {
      name: "a releaser with an empty stage",
      mayRelease: true,
      entries: [],
      allowed: false,
      reason: RELEASE_NOTHING_TO_LIST,
    },
  ])("for $name", ({ mayRelease, entries: list, allowed, reason }) => {
    const gate = releaseGate({ mayRelease, entries: list });
    expect(gate.allowed).toBe(allowed);
    if (!gate.allowed) expect(gate.reason).toBe(reason);
  });
});

describe("what Release offers, from what the environments run", () => {
  const stage = new Map([
    ["api", API],
    ["web", WEB],
  ]);

  it("compares the stage against production, per service, and offers the next patch", () => {
    const offer = releaseOffer({
      mayRelease: true,
      stage,
      production: new Map([
        ["api", OLD],
        ["web", WEB],
      ]),
      tags: ["v1.2.0"],
    });
    expect(offer.gate.allowed).toBe(true);
    expect(offer.suggestion).toBe("v1.2.1");
    expect(offer.comparison).toEqual([
      { service: "api", stage: "3f9c1b2", production: "1111111", changed: true },
      { service: "web", stage: "77ab0e1", production: "77ab0e1", changed: false },
    ]);
  });

  it.each([
    {
      name: "a stage two services ahead of production",
      mayRelease: true,
      stage,
      production: new Map([["api", OLD]]),
      allowed: true,
    },
    {
      name: "a production already running what the stage runs",
      mayRelease: true,
      stage,
      production: new Map(stage),
      allowed: false,
      reason: RELEASE_NOTHING_CHANGED,
    },
    {
      name: "a stage that has deployed nothing",
      mayRelease: true,
      stage: new Map<string, string>(),
      production: new Map([["api", OLD]]),
      allowed: false,
      reason: RELEASE_NOTHING_TO_LIST,
    },
    {
      name: "somebody who is not a releaser",
      mayRelease: false,
      stage,
      production: new Map<string, string>(),
      allowed: false,
      reason: RELEASE_NOT_A_RELEASER,
    },
  ])("answers, for $name", ({ mayRelease, stage: stageCommits, production, allowed, reason }) => {
    const gate = releaseOffer({ mayRelease, stage: stageCommits, production, tags: [] }).gate;
    expect(gate.allowed).toBe(allowed);
    if (!gate.allowed) expect(gate.reason).toBe(reason);
  });
});

describe("rolling back", () => {
  const earlier = `api ${OLD}\nweb ${WEB}`;

  it("is a new tag carrying the earlier one's message, exactly", () => {
    expect(
      rollbackTo({ tag: "v1.2.0", message: earlier, existingTags: ["v1.2.0", "v1.3.0"] }),
    ).toEqual({ tag: "v1.3.1", message: earlier });
  });

  it("never reuses a name, even rolling back to the newest but one", () => {
    const result = rollbackTo({
      tag: "v1.2.0",
      message: earlier,
      existingTags: ["v1.2.0", "v1.3.0"],
    });
    expect(["v1.2.0", "v1.3.0"]).not.toContain(result?.tag);
  });

  it("refuses a tag whose message this build cannot read", () => {
    expect(
      rollbackTo({ tag: "v1.2.0", message: "deployed the invoices work", existingTags: [] }),
    ).toBeUndefined();
  });
});

describe("the broker's verdict on a tag", () => {
  const status = (state: GiteaCommitStatus["state"], description?: string): GiteaCommitStatus => ({
    context: releaseStatusContext("v1.2.0"),
    state,
    ...(description === undefined ? {} : { description }),
  });

  it.each([
    { name: "approved", statuses: [status("success")], verdict: "approved", word: "Approved" },
    {
      name: "refused, with the reason",
      statuses: [status("failure", "ada is not a releaser")],
      verdict: "refused",
      word: "Refused",
    },
    {
      name: "still being checked",
      statuses: [status("pending")],
      verdict: "pending",
      word: "Checking",
    },
    { name: "nothing said yet", statuses: [], verdict: "unknown", word: undefined },
  ] as const)("reads $name", ({ statuses, verdict, word }) => {
    expect(releaseVerdict("v1.2.0", statuses).verdict).toBe(verdict);
    expect(releaseWord(verdict)).toBe(word);
  });

  it("does not take another tag's verdict for this one", () => {
    const statuses = [{ context: "mate/release/v1.1.0", state: "success" } as GiteaCommitStatus];
    expect(releaseVerdict("v1.2.0", statuses).verdict).toBe("unknown");
  });

  it("carries the description a refusal came with", () => {
    expect(releaseVerdict("v1.2.0", [status("failure", "ada is not a releaser")]).detail).toBe(
      "ada is not a releaser",
    );
  });
});
