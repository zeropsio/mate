import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CreateReleaseRequest,
  RELEASE_MESSAGE_REFUSALS,
  RELEASE_REFUSALS,
  RELEASES_SHOWN,
  Release,
  ReleaseTag,
  RollbackRequest,
  compareReleaseTags,
  nextPatch,
  parseReleaseMessage,
  releaseMessage,
} from "./hqRelease.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const LONG = "c".repeat(64);

const read = (schema: Schema.Codec<unknown, unknown>, value: unknown) =>
  Schema.decodeUnknownExit(schema)(value)._tag;

describe("hqRelease", () => {
  it.each([
    ["one service", `api ${A}`, [{ service: "api", sha: A }]],
    [
      "services sorted, whatever the order written",
      `web ${B}\napi ${A}`,
      [
        { service: "api", sha: A },
        { service: "web", sha: B },
      ],
    ],
    [
      "blank and whitespace-only lines between entries",
      `\napi ${A}\n   \n\nweb ${B}\n`,
      [
        { service: "api", sha: A },
        { service: "web", sha: B },
      ],
    ],
    ["a line's own surrounding spaces", `  api ${A}  `, [{ service: "api", sha: A }]],
    ["spaces before the sha", `api    ${A}`, [{ service: "api", sha: A }]],
    ["a SHA-256 commit", `api ${LONG}`, [{ service: "api", sha: LONG }]],
    [
      "a hostname of 40 characters",
      `a${"b".repeat(39)} ${A}`,
      [{ service: `a${"b".repeat(39)}`, sha: A }],
    ],
    [
      "a service listed twice at one commit, once",
      `api ${A}\napi ${A}`,
      [{ service: "api", sha: A }],
    ],
  ])("reads a release's message: %s", (_name, message, entries) => {
    expect(parseReleaseMessage(message)).toEqual({ entries });
  });

  it.each([
    ["nothing", "", "release_empty"],
    ["only blank lines", "\n  \n\t\n", "release_empty"],
    ["a service at two commits", `api ${A}\napi ${B}`, "release_service_twice"],
    ["a line with a third field", `api ${A} extra`, "release_line_unreadable"],
    ["a line with no sha", "api", "release_line_unreadable"],
    ["a tab for the space", `api\t${A}`, "release_line_unreadable"],
    ["a hostname that starts with a digit", `1api ${A}`, "release_line_unreadable"],
    ["an uppercase hostname", `Api ${A}`, "release_line_unreadable"],
    ["a hostname of 41 characters", `a${"b".repeat(40)} ${A}`, "release_line_unreadable"],
    ["a hostname with a dash", `my-api ${A}`, "release_line_unreadable"],
    ["a short sha", `api ${A.slice(0, 7)}`, "release_line_unreadable"],
    ["a sha of 39 hex", `api ${A.slice(1)}`, "release_line_unreadable"],
    ["an uppercase sha", `api ${A.toUpperCase()}`, "release_line_unreadable"],
    // A line it cannot read refuses the whole message: half a release would deploy half an app.
    ["one odd line among good ones", `api ${A}\nweb ${B}\n# a comment`, "release_line_unreadable"],
  ])("refuses a release's message: %s", (_name, message, refused) => {
    expect(parseReleaseMessage(message)).toEqual({ refused });
    expect(RELEASE_MESSAGE_REFUSALS).toContain(refused);
  });

  it("writes a release's message one sorted line per service, and reads it back", () => {
    const entries = [
      { service: "web", sha: B },
      { service: "api", sha: A },
    ];
    expect(releaseMessage(entries)).toBe(`api ${A}\nweb ${B}\n`);
    expect(parseReleaseMessage(releaseMessage(entries))).toEqual({
      entries: [entries[1], entries[0]],
    });
  });

  it.each([
    ["the first release", [], "v0.1.0"],
    ["names that are no release", ["latest", "v1.2", "v1.2.3-rc1", "1.2.3"], "v0.1.0"],
    ["the patch over the newest", ["v0.1.0", "v0.1.1"], "v0.1.2"],
    ["the newest by version, never by name", ["v0.9.0", "v0.10.0", "v0.2.7"], "v0.10.1"],
    ["the newest, whatever the order given", ["v2.0.0", "v1.9.9"], "v2.0.1"],
    [
      "a version past what a number holds",
      ["v0.0.99999999999999999999"],
      "v0.0.100000000000000000000",
    ],
  ])("suggests the next release's name: %s", (_name, tags, next) => {
    expect(nextPatch(tags)).toBe(next);
  });

  it("orders release names by version, numerically", () => {
    expect(
      ["v0.9.0", "v0.10.0", "v1.0.0", "v0.10.2", "v0.1.0"].toSorted(compareReleaseTags),
    ).toEqual(["v0.1.0", "v0.9.0", "v0.10.0", "v0.10.2", "v1.0.0"]);
    expect(compareReleaseTags("v1.0.0", "v01.0.0")).toBe(0);
    expect(compareReleaseTags("v10000000000000000001.0.0", "v10000000000000000000.0.0")).toBe(1);
  });

  it.each([
    ["a release name", ReleaseTag, "v1.2.3", "Success"],
    ["a name with no patch", ReleaseTag, "v1.2", "Failure"],
    ["a pre-release", ReleaseTag, "v1.2.3-rc1", "Failure"],
    ["a name without its v", ReleaseTag, "1.2.3", "Failure"],
    [
      "a release asked for",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [{ service: "api", sha: B }] },
      "Success",
    ],
    [
      "a release of nothing",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [] },
      "Failure",
    ],
    [
      "a release naming a service twice",
      CreateReleaseRequest,
      {
        tag: "v0.1.0",
        groupHead: A,
        entries: [
          { service: "api", sha: B },
          { service: "api", sha: B },
        ],
      },
      "Failure",
    ],
    [
      "a release naming a service no hostname is",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [{ service: "API", sha: B }] },
      "Failure",
    ],
    [
      "a release of a short sha",
      CreateReleaseRequest,
      { tag: "v0.1.0", groupHead: A, entries: [{ service: "api", sha: "abc1234" }] },
      "Failure",
    ],
    ["a rollback", RollbackRequest, { groupHead: A }, "Success"],
    ["a rollback with no head read", RollbackRequest, {}, "Failure"],
    [
      "an approved release",
      Release,
      {
        tag: "v0.1.0",
        sha: A,
        entries: [{ service: "api", sha: B }],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "approved",
        reason: null,
        rollbackOf: null,
      },
      "Success",
    ],
    [
      "a rollback, by the release it goes back to",
      Release,
      {
        tag: "v0.1.2",
        sha: A,
        entries: [{ service: "api", sha: B }],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "approved",
        reason: null,
        rollbackOf: "v0.1.0",
      },
      "Success",
    ],
    [
      "a refused release",
      Release,
      {
        tag: "v0.1.1",
        sha: A,
        entries: [],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "refused",
        reason: "release_line_unreadable",
        rollbackOf: null,
      },
      "Success",
    ],
    [
      "a release of a state this build does not know",
      Release,
      {
        tag: "v0.1.0",
        sha: A,
        entries: [],
        by: "U1",
        at: "2026-10-02T10:00:00.000Z",
        state: "pending",
        reason: null,
        rollbackOf: null,
      },
      "Failure",
    ],
  ])("reads %s", (_name, schema, value, expected) => {
    expect(read(schema as Schema.Codec<unknown, unknown>, value)).toBe(expected);
  });

  it("shows ten releases, as main's history did", () => {
    expect(RELEASES_SHOWN).toBe(10);
  });

  it("refuses a release by HQ's own reading, never by a message's", () => {
    expect(RELEASE_REFUSALS).toEqual([
      "group_moved",
      "no_group_main",
      "tag_taken",
      "tag_not_newer",
      "unknown_service",
      "entry_not_on_main",
      "release_not_approved",
    ]);
  });
});
