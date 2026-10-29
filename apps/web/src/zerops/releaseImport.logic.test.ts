import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import { describe, expect, it } from "vite-plus/test";

import { servicePlanImportYaml } from "./releaseImport.logic";

const DEPLOY = { kind: "deploy", service: "app", sha: "d".repeat(40) } as const;
const create = (settings: Record<string, unknown>) =>
  ({ kind: "create", service: String(settings["hostname"]), settings, cost: "" }) as const;
const plan = (operations: ReleaseServicePlan["operations"]): ReleaseServicePlan => ({
  hash: "a".repeat(64),
  operations,
});

describe("the import a release runs before it deploys", () => {
  it.each([
    {
      name: "creates the services production lacks, as the plan settles them",
      operations: [
        create({ hostname: "worker", type: "nodejs@22", minContainers: 2 }),
        create({ hostname: "storage", type: "object-storage", objectStorageSize: 20 }),
        DEPLOY,
      ],
      yaml: [
        "services:",
        "  - hostname: worker",
        "    type: nodejs@22",
        "    minContainers: 2",
        "  - hostname: storage",
        "    type: object-storage",
        "    objectStorageSize: 20",
        "",
      ].join("\n"),
    },
    {
      name: "turns the preprocessor on when a value is generated",
      operations: [
        create({
          hostname: "runner",
          type: "nodejs@24",
          envSecrets: { TOKEN: "<@generateRandomString(<32>)>" },
        }),
      ],
      yaml: [
        "#zeropsPreprocessor=on",
        "services:",
        "  - hostname: runner",
        "    type: nodejs@24",
        "    envSecrets:",
        "      TOKEN: <@generateRandomString(<32>)>",
        "",
      ].join("\n"),
    },
    { name: "is none when production lacks nothing", operations: [DEPLOY], yaml: undefined },
  ])("$name", ({ operations, yaml }) => {
    expect(servicePlanImportYaml(plan(operations))).toBe(yaml);
  });
});
