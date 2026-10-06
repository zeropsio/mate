import { describe, expect, it } from "vite-plus/test";

import { pictureId, pictureScope } from "../families/hqPicture.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { hqPicture } from "./hqPicture.ts";

const key = { orgId: "org", link: { appId: "app", repo: "repo", number: 1, id: "picture" } };
const scope = pictureScope(key);
const blob = new Blob(["picture"], { type: "image/png" });
const baseline: AccountInput = {
  kind: "baseline-commit",
  scope,
  generation: 0,
  via: "hq-stream",
  members: [pictureId(key)],
  rows: [
    {
      family: "hqPicture",
      id: pictureId(key),
      value: blob,
      revision: { kind: "hq", incarnation: pictureId(key), revision: 0 },
    },
  ],
};
const apply = (inputs: ReadonlyArray<AccountInput>): AccountState =>
  inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);

describe("a change's picture projection", () => {
  it.each([
    { name: "unknown", inputs: [], kind: "reading" },
    { name: "read", inputs: [baseline], kind: "read" },
    {
      name: "partial coverage keeps bytes",
      inputs: [{ ...baseline, partial: true }],
      kind: "read",
    },
    {
      name: "outage keeps bytes",
      inputs: [baseline, { kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } }],
      kind: "read",
    },
    {
      name: "refusal is visible",
      inputs: [
        {
          kind: "stream",
          key: scope,
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "definitive-refusal", message: "No picture." },
          },
        },
      ],
      kind: "failed",
    },
    {
      name: "denial purges bytes",
      inputs: [
        baseline,
        { kind: "access", family: "hqPicture", id: pictureId(key), access: "denied" },
        {
          kind: "stream",
          key: scope,
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "authoritative-denial", message: "No access." },
          },
        },
      ],
      kind: "failed",
    },
  ] as const)("$name", ({ inputs, kind }) => {
    const read = hqPicture.derive(readsOfState(apply(inputs)), key);
    expect(read.kind).toBe(kind);
    if (read.kind === "read") expect(read.blob).toBe(blob);
  });

  it("compares picture bytes by identity", () => {
    expect(hqPicture.equals({ kind: "read", blob }, { kind: "read", blob })).toBe(true);
    expect(
      hqPicture.equals({ kind: "read", blob }, { kind: "read", blob: new Blob(["other"]) }),
    ).toBe(false);
  });
});
