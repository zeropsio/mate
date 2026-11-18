import { expect, it } from "vite-plus/test";

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
const pictureOf = (inputs: ReadonlyArray<AccountInput>) =>
  hqPicture.derive(readsOfState(apply(inputs)), key);

// witness: packages/client-runtime/src/data/projections/hqPicture.ts | if (fact.kind === "known") return → if (fact.kind === "known" && read.stream(pictureScope(key)).phase === "live") return
it("PJ45: A change's picture bytes are purged when HQ denies them, and kept through an outage", () => {
  const denied = pictureOf([
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
  ]);
  expect(denied.kind).toBe("failed");
  const outage = pictureOf([
    baseline,
    { kind: "stream", key: scope, now: 0, event: { kind: "parent-lost" } },
  ]);
  expect(outage.kind).toBe("read");
  expect(outage.kind === "read" ? outage.blob : null).toBe(blob);
});
