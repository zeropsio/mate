import { describe, expect, it } from "vite-plus/test";
import { RepoListEntry } from "@t3tools/shared/hqChanges";
import * as Schema from "effect/Schema";

import { hqAppDetailFamily } from "./hqAppDetail.ts";
import { gitRemote } from "../__fixtures__/hqWire.ts";

const hq = hqAppDetailFamily.hq!;
const readRepo = Schema.decodeUnknownSync(RepoListEntry);
const repo = readRepo({
  name: "api",
  mainHead: "a".repeat(40),
  updatedAt: "2026-10-06T00:00:00Z",
});

describe("hqAppDetailFamily", () => {
  it.each([undefined, null])(
    "an omitted remote preserves custody while explicit disconnection replaces it: %s",
    (remote) => {
      const held = hq.decode([readRepo({ ...repo, remote: gitRemote })], "repos")!;
      const row = hq.decode(
        [readRepo({ ...repo, ...(remote === undefined ? {} : { remote }) })],
        "repos",
      )!;
      expect(hqAppDetailFamily.keepUnsaid!(held, row, "listing")).toEqual({
        kind: "repos",
        value: [{ ...repo, ...(remote === null ? { remote: null } : { remote: gitRemote }) }],
      });
    },
  );
});
