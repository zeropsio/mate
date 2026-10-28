import { describe, expect, it } from "vite-plus/test";

import { sharedEnvironmentRows } from "./ConnectionsSettings.logic";

const env = (id: string, tier: "production" | "stage", name: string) => ({ id, tier, name });

// The live audit (2026-10-28): Settings › Environments listed each application's production alone,
// by its slug ("demo-app-production"), and none of the stages Larkspur, Nebius and ZIT have.
describe("Settings › Environments", () => {
  it.each([
    {
      case: "every shared environment of every application, production first, each by its title",
      apps: [
        {
          id: "nebius",
          name: "Nebius Demo",
          environments: [
            env("n-stage", "stage", "stage"),
            env("n-prod", "production", "demo-app-production"),
          ],
        },
        { id: "zit", name: "ZIT", environments: [env("z-stage", "stage", "client demo")] },
      ],
      rows: [
        {
          appId: "nebius",
          environmentId: "n-prod",
          tier: "production",
          title: "Nebius Demo · Production",
        },
        { appId: "nebius", environmentId: "n-stage", tier: "stage", title: "Nebius Demo · Stage" },
        { appId: "zit", environmentId: "z-stage", tier: "stage", title: "ZIT · Client demo" },
      ],
    },
    {
      case: "nothing of an application whose environments HQ refused or has not sent",
      apps: [
        { id: "a", name: "A", environments: { refused: "no access" } },
        { id: "b", name: "B", environments: undefined },
      ],
      rows: [],
    },
  ] as const)("Settings lists $case", ({ apps, rows }) => {
    expect(sharedEnvironmentRows(apps)).toEqual(rows);
  });
});
