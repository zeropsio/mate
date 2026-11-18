import { expect, it } from "vite-plus/test";

import { projectSpendScope, type ProjectSpendValue } from "../families/projectSpend.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { computeSpend } from "./projectSpend.ts";

const ORG = "acme";
const spend = (value: Partial<ProjectSpendValue> = {}): AccountInput => ({
  kind: "baseline-commit",
  scope: projectSpendScope(ORG),
  generation: 0,
  via: "zerops-read",
  members: [ORG],
  rows: [
    {
      family: "projectSpend",
      id: ORG,
      value: {
        firstDay: "2026-09-19",
        lastDay: "2026-10-18",
        complete: true,
        byProject: {
          "tea-prod": { "2026-10-18": 1.5, "2026-09-19": 0.25 },
          "tea-stage": { "2026-10-18": 0.5 },
          "tea-raya": { "2026-10-10": 2 },
          watchlist: { "2026-10-18": 9 },
        },
        outsideProjects: {},
        ...value,
      },
      revision: { kind: "zerops", version: null },
    },
  ],
});
const derive = (inputs: ReadonlyArray<AccountInput>, projectIds: ReadonlyArray<string>) =>
  computeSpend.derive(
    readsOfState(inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount)),
    { orgId: ORG, projectIds },
  );

// witness: packages/client-runtime/src/data/projections/projectSpend.ts | const projects = [...new Set(projectIds)]; → const projects = Object.keys(spend.byProject);
it("PJ21: A project's compute spend never counts another project's", () => {
  const read = derive([spend()], ["tea-prod"]);
  expect(read.kind === "read" && read.usd.at(-1)).toBe(1.5);
});

// witness: packages/client-runtime/src/data/projections/projectSpend.ts | !spend.complete && projectIds.some( → !spend.complete && projectIds.every(
it("PJ22: A project that a partial billing answer leaves out has unknown spend, never zero", () => {
  expect(derive([spend({ complete: false })], ["tea-prod", "nextstore"]).kind).toBe("unknown");
});
