import { expect, it } from "vite-plus/test";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { repoGovernanceId, repoGovernanceScope } from "../families/hqRepoGovernance.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { hqRepoGovernance } from "./hqRepoGovernance.ts";

const key = { orgId: "org", appId: "shop" };
const url = "https://github.com/shop/current.git";
const syncedAt = "2026-10-06T00:00:00Z";
const repo = (name: string) => ({
  name,
  mainHead: null,
  updatedAt: syncedAt,
  remote: {
    url,
    repositoryId: "7",
    via: "app" as const,
    githubAppId: 12,
    keptBy: "owner",
    keptAt: syncedAt,
    expiresAt: null,
    invalidSince: null,
  },
  mirror: { syncedAt, divergedSince: null },
});

// witness: packages/client-runtime/src/data/projections/hqRepoGovernance.ts | entry?.url === url && entry.synced === synced → entry?.url === url || entry?.synced === synced
it("PJ83: A repository's GitHub rules read as not read while the answer held is for another remote or from before its first sync; breaks: the connect dialog says done without its gate line, or shows another repository's verdict.", () => {
  const repos = [repo("reconnected"), repo("first-sync"), repo("current")];
  const detail: AccountInput = {
    kind: "baseline-commit",
    scope: hqAppDetailScope(key.orgId, key.appId),
    generation: 0,
    via: "hq-stream",
    members: ["shop/repos"],
    rows: [
      {
        family: "hqAppDetail",
        id: "shop/repos",
        revision: { kind: "hq", incarnation: "i", revision: 1 },
        value: { kind: "repos", value: repos },
      },
    ],
  };
  const id = repoGovernanceId(key);
  const answer: AccountInput = {
    kind: "baseline-commit",
    scope: repoGovernanceScope(key),
    generation: 0,
    via: "hq-stream",
    members: [id],
    rows: [
      {
        family: "hqRepoGovernance",
        id,
        revision: { kind: "mate-link", sequence: 1 },
        value: [
          {
            name: "reconnected",
            url: "https://github.com/shop/old.git",
            synced: true,
            governance: "governed",
          },
          { name: "first-sync", url, synced: false, governance: null },
          { name: "current", url, synced: true, governance: "no_ruleset" },
        ],
      },
    ],
  };
  const state = reduceAccount(reduceAccount(emptyAccount, detail).state, answer).state;
  expect(hqRepoGovernance.derive(readsOfState(state), key)).toEqual({
    wanted: true,
    of: {
      reconnected: { kind: "reading" },
      "first-sync": { kind: "reading" },
      current: { kind: "read", governance: "no_ruleset" },
    },
  });
});
